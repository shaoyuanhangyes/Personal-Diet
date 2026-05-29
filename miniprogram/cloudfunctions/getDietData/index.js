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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  if (!openid) {
    throw new Error("missing openid");
  }

  const collectionResults = await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));

  const [profileDoc, foodDoc, dailyMealsDoc] = await Promise.all([
    getDocument(COLLECTIONS.profile, openid),
    getDocument(COLLECTIONS.foods, openid),
    getDocument(COLLECTIONS.dailyMeals, openid)
  ]);

  return {
    ok: true,
    openid,
    collections: collectionResults,
    hasProfileData: !!profileDoc,
    hasFoodData: !!foodDoc,
    hasMealData: !!dailyMealsDoc,
    profile: profileDoc && profileDoc.profile ? profileDoc.profile : null,
    energyUnit: profileDoc && profileDoc.energyUnit ? profileDoc.energyUnit : "",
    foods: foodDoc && Array.isArray(foodDoc.foods) ? foodDoc.foods : [],
    todayMeals: dailyMealsDoc && Array.isArray(dailyMealsDoc.todayMeals) ? dailyMealsDoc.todayMeals : [],
    dailyMeals: dailyMealsDoc && dailyMealsDoc.dailyMeals ? dailyMealsDoc.dailyMeals : {}
  };
};
