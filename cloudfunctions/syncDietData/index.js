const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database({ throwOnNotFound: false });

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
  const result = await db.collection(collection).where({ _id: id }).limit(1).get();
  if (!result || !Array.isArray(result.data)) throw new Error(`invalid read result from ${collection}`);
  return result.data[0] || null;
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
    const labelEnergy = food.energy === undefined || food.energy === null || food.energy === ""
      ? null : Number(food.energy);
    summary.kcal += labelEnergy !== null && Number.isFinite(labelEnergy) && labelEnergy >= 0
      ? labelEnergy * scale : carbs * 4 + protein * 4 + fat * 9;
    summary.carbs += carbs;
    summary.protein += protein;
    summary.fat += fat;
    summary.mealCount += 1;
    return summary;
  }, { kcal: 0, carbs: 0, protein: 0, fat: 0, mealCount: 0 });
}

function mergeMealChanges(remote, local, base) {
  if (!Array.isArray(base)) return local;
  const key = (meal) => meal && meal.id ? String(meal.id) : JSON.stringify(meal);
  const baseById = new Map(base.map((meal) => [key(meal), meal]));
  const localById = new Map(local.map((meal) => [key(meal), meal]));
  const deleted = new Set([...baseById.keys()].filter((id) => !localById.has(id)));
  const changed = local.filter((meal) => {
    const previous = baseById.get(key(meal));
    return !previous || JSON.stringify(previous) !== JSON.stringify(meal);
  });
  const changedIds = new Set(changed.map(key));
  return [...changed, ...remote.filter((meal) => !deleted.has(key(meal)) && !changedIds.has(key(meal)))];
}

async function saveDailyRecord(openid, incomingMeals, incomingSummaries, todayDate, todayMeals, overwriteDates, mealBases) {
  let uploadedDates = 0;
  const confirmedMeals = {};
  await db.runTransaction(async (transaction) => {
    const document = transaction.collection(COLLECTIONS.dailyMeals).doc(openid);
    const result = await document.get();
    const existing = result && result.data ? result.data : null;
    const existingMeals = (existing && existing.dailyMeals) || {};
    const mergedMeals = { ...incomingMeals, ...existingMeals };
    overwriteDates.forEach((date) => {
      mergedMeals[date] = mergeMealChanges(existingMeals[date] || [], incomingMeals[date], mealBases[date]);
      confirmedMeals[date] = mergedMeals[date];
    });
    const writeToday = todayDate && (overwriteDates.includes(todayDate)
      || !Object.prototype.hasOwnProperty.call(existingMeals, todayDate));
    if (writeToday && !overwriteDates.includes(todayDate)) mergedMeals[todayDate] = todayMeals;

    const calculated = {};
    Object.keys(mergedMeals).forEach((date) => {
      if (Array.isArray(mergedMeals[date]) && mergedMeals[date].length) {
        calculated[date] = mealSummary(mergedMeals[date]);
      }
    });
    overwriteDates.forEach((date) => {
      calculated[date] = mealSummary(mergedMeals[date]);
    });
    if (writeToday) calculated[todayDate] = mealSummary(mergedMeals[todayDate]);
    const dailySummaries = {
      ...incomingSummaries,
      ...((existing && existing.dailySummaries) || {}),
      ...calculated
    };
    await document.set({
      data: {
        openid,
        todayDate: todayDate || (existing && existing.todayDate) || "",
        todayMeals: todayDate ? mergedMeals[todayDate] : ((existing && existing.todayMeals) || []),
        dailyMeals: mergedMeals,
        dailySummaries,
        updatedAt: db.serverDate()
      }
    });
    uploadedDates = Object.keys(dailySummaries).length;
  }, 5);
  return { uploadedDates, confirmedMeals };
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

async function saveSharedFoods(incomingFoods, mutations) {
  let foodCount = 0;
  await db.runTransaction(async (transaction) => {
    const document = transaction.collection(COLLECTIONS.foods).doc(SHARED_FOOD_DOCUMENT);
    const result = await document.get();
    const existing = result && result.data ? result.data : null;
    const foods = mergeFoods(existing && existing.foods, incomingFoods, mutations);
    await document.set({
      data: {
        scope: "shared",
        foods,
        updatedAt: db.serverDate()
      }
    });
    foodCount = foods.length;
  }, 5);
  return foodCount;
}

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) {
    throw new Error("missing openid");
  }

  const profile = event.profile && typeof event.profile === "object" ? event.profile : {};
  const foods = Array.isArray(event.foods) ? event.foods.slice(0, 300) : [];
  const todayMeals = Array.isArray(event.todayMeals) ? event.todayMeals.slice(0, 300) : [];
  const dailyMeals = event.dailyMeals && typeof event.dailyMeals === "object" && !Array.isArray(event.dailyMeals) ? event.dailyMeals : {};
  const incomingSummaries = event.dailySummaries && typeof event.dailySummaries === "object" && !Array.isArray(event.dailySummaries) ? event.dailySummaries : {};
  const overwriteDates = [...new Set((Array.isArray(event.overwriteDates) ? event.overwriteDates : [])
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)
      && Object.prototype.hasOwnProperty.call(dailyMeals, date)
      && Array.isArray(dailyMeals[date])))];
  const mealBases = event.mealBases && typeof event.mealBases === "object" && !Array.isArray(event.mealBases)
    ? event.mealBases : {};
  const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event.todayDate || "")) ? event.todayDate : "";
  const syncScope = ["foods", "calendar"].includes(event.syncScope) ? event.syncScope : "all";
  const energyUnit = event.energyUnit === "kJ" ? "kJ" : "kcal";
  const updatedAt = db.serverDate();

  if (syncScope === "calendar") {
    await ensureCollection(COLLECTIONS.dailyMeals);
    const saved = await saveDailyRecord(openid, dailyMeals, incomingSummaries, todayDate, todayMeals, overwriteDates, mealBases);
    return { ok: true, openid, ...saved };
  }

  const collectionResults = await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));
  const sharedFoodDoc = await getDocument(COLLECTIONS.foods, SHARED_FOOD_DOCUMENT);
  const foodMutations = [
    ...(Array.isArray(event.foodMutations) ? event.foodMutations : []),
    ...(event.foodMutation ? [event.foodMutation] : [])
  ].slice(-100);
  let foodCount = mergeFoods(
    sharedFoodDoc && sharedFoodDoc.foods,
    foods,
    foodMutations
  ).length;
  if (foodMutations.length || (!sharedFoodDoc && foodCount)) {
    foodCount = await saveSharedFoods(foods, foodMutations);
  }
  if (syncScope === "foods") {
    return {
      ok: true,
      openid,
      collections: collectionResults,
      foodCount,
      mealCount: 0
    };
  }
  const saved = await saveDailyRecord(openid, dailyMeals, incomingSummaries, todayDate, todayMeals, overwriteDates, mealBases);

  const writes = [
    db.collection(COLLECTIONS.profile).doc(openid).set({
      data: {
        openid,
        profile,
        energyUnit,
        updatedAt
      }
    })
  ];
  await Promise.all(writes);

  return {
    ok: true,
    openid,
    collections: collectionResults,
    foodCount,
    mealCount: todayMeals.length,
    ...saved
  };
};
