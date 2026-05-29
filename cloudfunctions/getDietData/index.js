const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

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

  const [profileDoc, foodDoc] = await Promise.all([
    getDocument("diet_user_profiles", openid),
    getDocument("diet_food_catalogs", openid)
  ]);

  return {
    ok: true,
    openid,
    profile: profileDoc && profileDoc.profile ? profileDoc.profile : null,
    foods: foodDoc && Array.isArray(foodDoc.foods) ? foodDoc.foods : []
  };
};
