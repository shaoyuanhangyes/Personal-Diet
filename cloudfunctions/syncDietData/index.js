const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID || event.openid;
  if (!openid) {
    throw new Error("missing openid");
  }

  const profile = event.profile && typeof event.profile === "object" ? event.profile : {};
  const foods = Array.isArray(event.foods) ? event.foods.slice(0, 300) : [];
  const updatedAt = db.serverDate();

  await Promise.all([
    db.collection("diet_user_profiles").doc(openid).set({
      data: {
        openid,
        profile,
        updatedAt
      }
    }),
    db.collection("diet_food_catalogs").doc(openid).set({
      data: {
        openid,
        foods,
        updatedAt
      }
    })
  ]);

  return {
    ok: true,
    openid,
    foodCount: foods.length
  };
};
