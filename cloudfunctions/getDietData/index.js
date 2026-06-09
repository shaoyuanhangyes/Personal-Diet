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

async function getDocument(collection, openid) {
  try {
    const result = await db.collection(collection).doc(openid).get();
    return result && result.data ? result.data : null;
  } catch (error) {
    return null;
  }
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

exports.main = async (event = {}) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  if (!openid) {
    throw new Error("missing openid");
  }

  const collectionResults = await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));

  const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(String(event.todayDate || "")) ? event.todayDate : "";
  const [profileDoc, sharedFoodDoc, legacyFoodDoc, dailyMealsDoc] = await Promise.all([
    getDocument(COLLECTIONS.profile, openid),
    getDocument(COLLECTIONS.foods, SHARED_FOOD_DOCUMENT),
    getDocument(COLLECTIONS.foods, openid),
    getDocument(COLLECTIONS.dailyMeals, openid)
  ]);
  const sharedFoods = sharedFoodDoc && Array.isArray(sharedFoodDoc.foods) ? sharedFoodDoc.foods : [];
  const legacyFoods = legacyFoodDoc && Array.isArray(legacyFoodDoc.foods) ? legacyFoodDoc.foods : [];
  const foodMap = new Map();
  sharedFoods.concat(legacyFoods).forEach((food) => {
    const key = foodKey(food);
    if (!foodMap.has(key)) foodMap.set(key, normalizeFood(food));
  });
  const foods = Array.from(foodMap.values()).slice(0, 500);
  if (legacyFoods.length || foods.length !== sharedFoods.length) {
    await db.collection(COLLECTIONS.foods).doc(SHARED_FOOD_DOCUMENT).set({
      data: {
        scope: "shared",
        foods,
        updatedAt: db.serverDate()
      }
    });
    try {
      await db.collection(COLLECTIONS.foods).doc(openid).remove();
    } catch (error) {
      // Migration is already complete if the legacy document was removed earlier.
    }
  }
  const dailyMeals = dailyMealsDoc && dailyMealsDoc.dailyMeals ? dailyMealsDoc.dailyMeals : {};
  const hasTodayData = !!todayDate && Object.prototype.hasOwnProperty.call(dailyMeals, todayDate);

  return {
    ok: true,
    openid,
    collections: collectionResults,
    hasProfileData: !!profileDoc,
    hasFoodData: foods.length > 0,
    hasMealData: !!dailyMealsDoc,
    hasTodayData,
    profile: profileDoc && profileDoc.profile ? profileDoc.profile : null,
    energyUnit: profileDoc && profileDoc.energyUnit ? profileDoc.energyUnit : "",
    foods,
    todayMeals: hasTodayData ? dailyMeals[todayDate] : [],
    dailyMeals,
    dailySummaries: dailyMealsDoc && dailyMealsDoc.dailySummaries ? dailyMealsDoc.dailySummaries : {}
  };
};
