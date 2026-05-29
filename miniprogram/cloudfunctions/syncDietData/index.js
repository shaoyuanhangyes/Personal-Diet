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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  if (!openid) {
    throw new Error("missing openid");
  }

  const profile = event.profile && typeof event.profile === "object" ? event.profile : {};
  const foods = Array.isArray(event.foods) ? event.foods.slice(0, 300) : [];
  const todayMeals = Array.isArray(event.todayMeals) ? event.todayMeals.slice(0, 300) : [];
  const dailyMeals = event.dailyMeals && typeof event.dailyMeals === "object" && !Array.isArray(event.dailyMeals) ? event.dailyMeals : {};
  const energyUnit = event.energyUnit === "kJ" ? "kJ" : "kcal";
  const updatedAt = db.serverDate();

  const collectionResults = await Promise.all(Object.keys(COLLECTIONS).map((key) => ensureCollection(COLLECTIONS[key])));

  await Promise.all([
    db.collection(COLLECTIONS.profile).doc(openid).set({
      data: {
        openid,
        profile,
        energyUnit,
        updatedAt
      }
    }),
    db.collection(COLLECTIONS.foods).doc(openid).set({
      data: {
        openid,
        foods,
        updatedAt
      }
    }),
    db.collection(COLLECTIONS.dailyMeals).doc(openid).set({
      data: {
        openid,
        todayMeals,
        dailyMeals,
        updatedAt
      }
    })
  ]);

  return {
    ok: true,
    openid,
    collections: collectionResults,
    foodCount: foods.length,
    mealCount: todayMeals.length
  };
};
