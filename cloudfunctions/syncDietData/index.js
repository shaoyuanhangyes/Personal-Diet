const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

const COLLECTIONS = {
  profile: "diet_user_profiles",
  foods: "diet_food_catalogs",
  dailyMeals: "diet_daily_meals"
};
const SHARED_FOOD_DOCUMENT = "shared";

async function ensureCollection(name) {
  try {
    await db.createCollection(name);
    return { name, status: "created" };
  } catch (error) {
    const message = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : "";
    if (/exist|already|duplicate|collection.*exists/i.test(message)) {
      return { name, status: "exists" };
    }
    try {
      await db.collection(name).limit(1).get();
      return { name, status: "exists" };
    } catch (readError) {
      const readMessage = readError && (readError.errMsg || readError.message) ? (readError.errMsg || readError.message) : "";
      throw new Error(`ensure collection ${name} failed: ${message || readMessage || "unknown error"}`);
    }
  }
}

async function getDocument(collection, id) {
  try {
    const result = await db.collection(collection).doc(id).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    return null;
  }
}

function mealSummary(meals) {
  return (Array.isArray(meals) ? meals : []).reduce((summary, meal) => {
    const food = meal && meal.food ? meal.food : {};
    const quantity = Number(meal && meal.quantity !== undefined ? meal.quantity : food.quantity) || 0;
    const coefficient = Number(food.coefficient || 1);
    const scale = String(food.unit || "").trim() === "个" ? quantity : quantity * coefficient / 100;
    const carbs = Number(food.carbs || 0) * scale;
    const protein = Number(food.protein || 0) * scale;
    const fat = Number(food.fat || 0) * scale;
    summary.kcal += carbs * 4 + protein * 4 + fat * 9;
    summary.carbs += carbs;
    summary.protein += protein;
    summary.fat += fat;
    summary.mealCount += 1;
    return summary;
  }, { kcal: 0, carbs: 0, protein: 0, fat: 0, mealCount: 0 });
}

function buildDailySummaries(dailyMeals) {
  const summaries = {};
  Object.keys(dailyMeals || {}).forEach((key) => {
    summaries[key] = mealSummary(dailyMeals[key]);
  });
  return summaries;
}

function foodKey(food) {
  const name = String(food && food.name || "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
  const unit = String(food && food.unit || "g")
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  return [
    name,
    unit
  ].join("|");
}

function normalizeFood(food) {
  return {
    ...food,
    name: String(food && food.name || "未命名食物").normalize("NFKC").trim(),
    unit: String(food && food.unit || "g").normalize("NFKC").trim() || "g",
    signature: foodKey(food)
  };
}

function mergeFoods(existingFoods, incomingFoods, mutations) {
  let foods = Array.isArray(existingFoods) ? existingFoods.slice() : [];
  if (!foods.length && Array.isArray(incomingFoods)) foods = incomingFoods.slice();
  (Array.isArray(mutations) ? mutations : []).forEach((mutation) => {
    if (mutation && mutation.type === "delete" && mutation.foodId) {
      foods = foods.filter((food) => food.id !== mutation.foodId);
    }
    if (mutation && mutation.type === "upsert" && mutation.food) {
      const nextFood = mutation.food;
      const index = foods.findIndex((food) => food.id === nextFood.id);
      if (index >= 0) foods[index] = nextFood;
      else foods.unshift(nextFood);
    }
  });
  const seen = new Set();
  return foods.map(normalizeFood).filter((food) => {
    const key = foodKey(food);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 500);
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  if (!openid) {
    throw new Error("missing openid");
  }

  const profile = event.profile && typeof event.profile === "object" ? event.profile : {};
  const foods = Array.isArray(event.foods) ? event.foods.slice(0, 300) : [];
  const todayMeals = Array.isArray(event.todayMeals) ? event.todayMeals.slice(0, 300) : [];
  const dailyMeals = event.dailyMeals && typeof event.dailyMeals === "object" && !Array.isArray(event.dailyMeals) ? event.dailyMeals : {};
  const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event.todayDate || "")) ? event.todayDate : "";
  const syncScope = event.syncScope === "foods" ? "foods" : "all";
  const energyUnit = event.energyUnit === "kJ" ? "kJ" : "kcal";
  const updatedAt = db.serverDate();

  const collectionResults = await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));
  const [sharedFoodDoc, existingDailyMealsDoc] = await Promise.all([
    getDocument(COLLECTIONS.foods, SHARED_FOOD_DOCUMENT),
    getDocument(COLLECTIONS.dailyMeals, openid)
  ]);
  const foodMutations = [
    ...(Array.isArray(event.foodMutations) ? event.foodMutations : []),
    ...(event.foodMutation ? [event.foodMutation] : [])
  ].slice(-100);
  const sharedFoods = mergeFoods(
    sharedFoodDoc && sharedFoodDoc.foods,
    foods,
    foodMutations
  );
  if (syncScope === "foods") {
    if (foodMutations.length || (!sharedFoodDoc && sharedFoods.length)) {
      await db.collection(COLLECTIONS.foods).doc(SHARED_FOOD_DOCUMENT).set({
        data: {
          scope: "shared",
          foods: sharedFoods,
          updatedAt
        }
      });
    }
    return {
      ok: true,
      openid,
      collections: collectionResults,
      foodCount: sharedFoods.length,
      mealCount: 0
    };
  }
  const mergedDailyMeals = {
    ...((existingDailyMealsDoc && existingDailyMealsDoc.dailyMeals) || {}),
    ...dailyMeals
  };
  if (todayDate) mergedDailyMeals[todayDate] = todayMeals;
  const dailySummaries = buildDailySummaries(mergedDailyMeals);

  const writes = [
    db.collection(COLLECTIONS.profile).doc(openid).set({
      data: {
        openid,
        profile,
        energyUnit,
        updatedAt
      }
    }),
    db.collection(COLLECTIONS.dailyMeals).doc(openid).set({
      data: {
        openid,
        todayDate,
        todayMeals: todayDate ? mergedDailyMeals[todayDate] : [],
        dailyMeals: mergedDailyMeals,
        dailySummaries,
        updatedAt
      }
    })
  ];
  if (foodMutations.length || (!sharedFoodDoc && sharedFoods.length)) {
    writes.push(db.collection(COLLECTIONS.foods).doc(SHARED_FOOD_DOCUMENT).set({
      data: {
        scope: "shared",
        foods: sharedFoods,
        updatedAt
      }
    }));
  }
  await Promise.all(writes);

  return {
    ok: true,
    openid,
    collections: collectionResults,
    foodCount: sharedFoods.length,
    mealCount: todayMeals.length
  };
};
