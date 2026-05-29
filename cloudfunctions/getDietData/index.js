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
  } catch (error) {
    return null;
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

  await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));

  const [profileDoc, foodDoc, dailyMealsDoc] = await Promise.all([
    getDocument(COLLECTIONS.profile, openid),
    getDocument(COLLECTIONS.foods, openid),
    getDocument(COLLECTIONS.dailyMeals, openid)
  ]);

  return {
    ok: true,
    openid,
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
