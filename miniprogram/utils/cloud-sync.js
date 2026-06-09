const USER_STORAGE_KEY = "dietUser";
const diet = require("./diet");

const syncTimers = {};
const pendingSyncPayloads = {};

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
  return callCloudFunction("getDietData", { todayDate: diet.dateKey() })
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
    dailySummaries: payload.dailySummaries && typeof payload.dailySummaries === "object" ? payload.dailySummaries : diet.buildDailySummaries(),
    todayDate: diet.dateKey(),
    foodMutation: payload.foodMutation || null,
    foodMutations: Array.isArray(payload.foodMutations) ? payload.foodMutations : [],
    syncScope: payload.syncScope || "all",
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
  const foodOnly = data.syncScope === "foods";
  if (!user && !foodOnly) {
    return Promise.resolve({ localOnly: true, message: "未登录，已保存在本机" });
  }
  return callCloudFunction("syncDietData", data)
    .then((result) => {
      if (foodOnly) {
        const sentMutations = [
          ...(Array.isArray(data.foodMutations) ? data.foodMutations : []),
          ...(data.foodMutation ? [data.foodMutation] : [])
        ];
        const sentIds = new Set(sentMutations.map((mutation) => mutation && mutation.mutationId).filter(Boolean));
        const sentLegacyKeys = new Set(sentMutations.filter((mutation) => mutation && !mutation.mutationId).map((mutation) => JSON.stringify(mutation)));
        const pending = wx.getStorageSync("dietPendingFoodMutations");
        const remaining = Array.isArray(pending)
          ? pending.filter((mutation) => mutation.mutationId
            ? !sentIds.has(mutation.mutationId)
            : !sentLegacyKeys.has(JSON.stringify(mutation)))
          : [];
        if (remaining.length) {
          wx.setStorageSync("dietPendingFoodMutations", remaining);
          wx.setStorageSync("dietFoodCatalogDirty", true);
        } else {
          wx.removeStorageSync("dietPendingFoodMutations");
          wx.setStorageSync("dietFoodCatalogDirty", false);
        }
      }
      return {
        localOnly: false,
        message: "已同步到后台",
        detail: result && result.result ? result.result : {}
      };
    })
    .catch((error) => ({
      localOnly: true,
      message: error && (error.errMsg || error.message) ? `云同步失败：${error.errMsg || error.message}` : "已保存在本机"
    }));
}

function queueSyncDietData(payload = {}, delay = 700) {
  const channel = payload.syncChannel || "diet";
  const previous = pendingSyncPayloads[channel] || {};
  const foodMutations = [
    ...(Array.isArray(previous.foodMutations) ? previous.foodMutations : []),
    ...(previous.foodMutation ? [previous.foodMutation] : []),
    ...(Array.isArray(payload.foodMutations) ? payload.foodMutations : []),
    ...(payload.foodMutation ? [payload.foodMutation] : [])
  ].slice(-100);
  pendingSyncPayloads[channel] = {
    ...previous,
    ...payload,
    foodMutation: null,
    foodMutations
  };
  clearTimeout(syncTimers[channel]);
  syncTimers[channel] = setTimeout(() => {
    const pendingPayload = pendingSyncPayloads[channel] || payload;
    delete pendingSyncPayloads[channel];
    syncDietData(pendingPayload).catch(() => {});
    delete syncTimers[channel];
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
