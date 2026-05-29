const USER_STORAGE_KEY = "dietUser";
const diet = require("./diet");

let syncTimer = null;

function getCloudReady() {
  let app = null;
  try {
    app = getApp();
  } catch (error) {
    app = null;
  }
  return !!(wx.cloud && app && app.globalData && app.globalData.cloudReady);
}

function getStoredUser() {
  try {
    return wx.getStorageSync(USER_STORAGE_KEY) || null;
  } catch (error) {
    return null;
  }
}

function saveStoredUser(user) {
  wx.setStorageSync(USER_STORAGE_KEY, user);
}

function clearStoredUser() {
  wx.removeStorageSync(USER_STORAGE_KEY);
}

function wechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) {
          resolve(result.code);
          return;
        }
        reject(new Error("微信登录未返回 code"));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function callCloudFunction(name, data = {}) {
  if (!getCloudReady()) {
    return Promise.reject(new Error("未启用微信云开发"));
  }
  return wx.cloud.callFunction({ name, data });
}

function resolveOpenId() {
  return callCloudFunction("login").then((result) => {
    const data = result && result.result ? result.result : {};
    return data.openid || data.OPENID || "";
  });
}

function fetchDietData() {
  return callCloudFunction("getDietData")
    .then((result) => result && result.result ? result.result : {})
    .catch((error) => {
      const message = error && (error.errMsg || error.message) ? (error.errMsg || error.message) : "云端数据读取失败";
      return { localOnly: true, message };
    });
}

function buildDietPayload(payload = {}) {
  return {
    openid: payload.openid || "",
    profile: payload.profile || diet.readProfile(),
    foods: Array.isArray(payload.foods) ? payload.foods : diet.readFoodCatalog(),
    todayMeals: Array.isArray(payload.todayMeals) ? payload.todayMeals : diet.readTodayMeals(),
    dailyMeals: payload.dailyMeals && typeof payload.dailyMeals === "object" ? payload.dailyMeals : diet.readDailyMealHistory(),
    energyUnit: payload.energyUnit || diet.readEnergyUnit(),
    updatedAt: Date.now()
  };
}

function loginWithWechat(payload = {}) {
  return wechatLogin()
    .then(() => resolveOpenId()
      .catch(() => "")
      .then((openid) => {
        const user = {
          name: "微信用户",
          phone: openid ? `OpenID ${openid.slice(-6)}` : "已调用微信登录",
          openid,
          hasWechatSession: true,
          loginAt: Date.now()
        };
        saveStoredUser(user);
        return fetchDietData().then((cloudData) => {
          const hasCloudProfile = cloudData && (cloudData.hasProfileData || (cloudData.profile && Object.keys(cloudData.profile).length > 0));
          const hasCloudFoods = cloudData && (cloudData.hasFoodData || (Array.isArray(cloudData.foods) && cloudData.foods.length > 0));
          const hasCloudMeals = cloudData && (cloudData.hasMealData || (
            (Array.isArray(cloudData.todayMeals) && cloudData.todayMeals.length > 0) ||
            (cloudData.dailyMeals && Object.keys(cloudData.dailyMeals).length > 0)
          ));
          const hasCloudUnit = cloudData && (cloudData.energyUnit === "kcal" || cloudData.energyUnit === "kJ");
          if (hasCloudProfile || hasCloudFoods || hasCloudMeals || hasCloudUnit) {
            return {
              user,
              cloudData,
              syncResult: { localOnly: false, message: "已从云端加载数据" }
            };
          }
          return syncDietData(payload).then((syncResult) => ({ user, syncResult, cloudData: null }));
        });
      }));
}

function syncDietData(payload = {}) {
  const user = getStoredUser();
  const data = buildDietPayload({
    ...payload,
    openid: user && user.openid ? user.openid : ""
  });
  wx.setStorageSync("dietLastSyncPayload", data);
  if (!user) {
    return Promise.resolve({ localOnly: true, message: "未登录，已保存在本机" });
  }
  return callCloudFunction("syncDietData", data)
    .then((result) => ({
      localOnly: false,
      message: "已同步到后台",
      detail: result && result.result ? result.result : {}
    }))
    .catch((error) => ({
      localOnly: true,
      message: error && (error.errMsg || error.message) ? `云同步失败：${error.errMsg || error.message}` : "已保存在本机"
    }));
}

function queueSyncDietData(payload = {}, delay = 700) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncDietData(payload).catch(() => {});
  }, delay);
}

module.exports = {
  buildDietPayload,
  clearStoredUser,
  fetchDietData,
  getStoredUser,
  loginWithWechat,
  queueSyncDietData,
  syncDietData
};
