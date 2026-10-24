const USER_STORAGE_KEY = "dietUser";
const diet = require("./diet");

const syncTimers = {};
const pendingSyncPayloads = {};
let calendarRefreshPromise = null;

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

function logoutAndClearLocalHistory() {
  Object.keys(syncTimers).forEach((channel) => {
    clearTimeout(syncTimers[channel]);
    delete syncTimers[channel];
    delete pendingSyncPayloads[channel];
  });
  clearStoredUser();
  [
    "dietTodayMeals",
    "dietTodayMealsDate",
    "dietTodayMealsDirtyDate",
    "dietDirtyMealDates",
    "dietDailyMeals",
    "dietDailySummaries",
    "dietLastSyncPayload",
    "dietProfile",
    "dietDayType",
    "dietEnergyUnit"
  ].forEach((key) => wx.removeStorageSync(key));
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

function calendarRecordDates(meals, summaries) {
  return [...new Set([
    ...Object.keys(meals || {}).filter((key) => Array.isArray(meals[key]) && meals[key].length > 0),
    ...Object.keys(summaries || {}).filter((key) => {
      const summary = summaries[key];
      return summary && (Number(summary.kcal) > 0 || Number(summary.mealCount) > 0);
    })
  ])];
}

function calendarRecordMatches(key, localMeals, localSummaries, cloudMeals, cloudSummaries) {
  const local = localSummaries[key];
  const remote = cloudSummaries[key];
  if (!local || !remote) return false;
  for (const field of ["kcal", "carbs", "protein", "fat", "mealCount"]) {
    if (Math.abs(Number(local[field] || 0) - Number(remote[field] || 0)) > 0.01) return false;
  }
  const meals = localMeals[key];
  if (Array.isArray(meals) && meals.length > 0) {
    return JSON.stringify(meals) === JSON.stringify(cloudMeals[key]);
  }
  return true;
}

function refreshCalendarHistory(onRead) {
  if (calendarRefreshPromise) return calendarRefreshPromise;
  const user = getStoredUser();
  if (!user || !user.openid) {
    return Promise.resolve({ localOnly: true, message: "登录后可跨设备同步日历" });
  }
  calendarRefreshPromise = fetchDietData().then((cloudData) => {
    if (cloudData.localOnly) return cloudData;
    const currentUser = getStoredUser();
    if (!currentUser) return { localOnly: true, message: "已退出登录" };
    if (currentUser.openid !== user.openid) {
      return { localOnly: true, message: "登录账号已变化，请重新打开日历" };
    }
    if (cloudData.openid !== user.openid) {
      return { localOnly: true, message: "云端账号不一致，请重新登录" };
    }

    const today = diet.dateKey();
    const localTodayMeals = diet.readTodayMeals();
    const localMeals = diet.readDailyMealHistory();
    const localSummaries = diet.readDailySummaries();
    const dirtyDates = diet.readDirtyMealDates();
    const cloudMeals = cloudData.dailyMeals && typeof cloudData.dailyMeals === "object" ? cloudData.dailyMeals : {};
    const mergedMeals = { ...localMeals, ...cloudMeals };
    dirtyDates.forEach((date) => {
      if (Object.prototype.hasOwnProperty.call(localMeals, date)) mergedMeals[date] = localMeals[date];
    });
    const cloudTodayMeals = cloudData.hasTodayData && Array.isArray(cloudData.todayMeals) ? cloudData.todayMeals : null;
    const restoreToday = cloudTodayMeals && !dirtyDates.includes(today);
    if (!restoreToday && (Object.prototype.hasOwnProperty.call(localMeals, today) || localTodayMeals.length)) {
      mergedMeals[today] = localTodayMeals;
    }
    diet.saveDailyMealHistory(mergedMeals);
    if (restoreToday) diet.saveTodayMeals(cloudTodayMeals, { fromCloud: true });

    const cloudSummaries = cloudData.dailySummaries && typeof cloudData.dailySummaries === "object" ? cloudData.dailySummaries : {};
    const summaries = { ...localSummaries, ...cloudSummaries };
    Object.keys(mergedMeals).forEach((key) => {
      if (mergedMeals[key].length || !Object.prototype.hasOwnProperty.call(summaries, key)) {
        summaries[key] = diet.buildDailySummary(mergedMeals[key]);
      }
    });
    dirtyDates.forEach((date) => {
      if (Object.prototype.hasOwnProperty.call(localMeals, date)) {
        summaries[date] = diet.buildDailySummary(localMeals[date]);
      }
    });
    if (restoreToday) summaries[today] = diet.buildDailySummary(cloudTodayMeals);
    diet.saveDailySummaries(summaries);
    const readCount = calendarRecordDates(cloudMeals, cloudSummaries).length;
    const readMessage = `云端已读取 ${readCount} 天记录`;
    if (onRead) onRead({ localOnly: false, message: readMessage });

    const localDates = calendarRecordDates(mergedMeals, summaries);
    const needsUpload = localDates.filter((key) => !calendarRecordMatches(key, mergedMeals, summaries, cloudMeals, cloudSummaries));
    dirtyDates.forEach((date) => {
      if (!calendarRecordMatches(date, mergedMeals, summaries, cloudMeals, cloudSummaries)
        || JSON.stringify(mergedMeals[date]) !== JSON.stringify(cloudMeals[date])) {
        if (!needsUpload.includes(date)) needsUpload.push(date);
      }
    });
    const verify = (verifiedData) => {
      if (verifiedData.localOnly || verifiedData.openid !== user.openid) {
        return { localOnly: false, message: `${readMessage} · 上传未验证` };
      }
      const verifiedMeals = verifiedData.dailyMeals || {};
      const verifiedSummaries = verifiedData.dailySummaries || {};
      const uploadedCount = localDates.filter((key) =>
        calendarRecordMatches(key, mergedMeals, summaries, verifiedMeals, verifiedSummaries)).length;
      const verifiedDirtyDates = dirtyDates.filter((date) =>
        calendarRecordMatches(date, mergedMeals, summaries, verifiedMeals, verifiedSummaries)
        && JSON.stringify(mergedMeals[date]) === JSON.stringify(verifiedMeals[date]));
      diet.clearDirtyMealDates(verifiedDirtyDates.filter((date) =>
        JSON.stringify(diet.readDailyMealHistory()[date]) === JSON.stringify(mergedMeals[date])));
      const allVerified = uploadedCount === localDates.length && verifiedDirtyDates.length === dirtyDates.length;
      return {
        localOnly: false,
        verified: allVerified,
        message: allVerified
          ? `${readMessage} · 已上传 ${uploadedCount} 天记录`
          : `${readMessage} · 已核对 ${uploadedCount}/${localDates.length} 天，上传待确认`
      };
    };
    if (!needsUpload.length) return verify(cloudData);

    const uploadMeals = {};
    const uploadSummaries = {};
    needsUpload.forEach((key) => {
      if (Array.isArray(mergedMeals[key])) uploadMeals[key] = mergedMeals[key];
      if (summaries[key]) uploadSummaries[key] = summaries[key];
    });
    const uploadToday = needsUpload.includes(today) && (dirtyDates.includes(today) || !cloudTodayMeals);
    return callCloudFunction("syncDietData", {
      syncScope: "calendar",
      dailyMeals: uploadMeals,
      dailySummaries: uploadSummaries,
      overwriteDates: dirtyDates.filter((date) => needsUpload.includes(date)),
      todayDate: uploadToday ? today : "",
      todayMeals: uploadToday ? diet.readTodayMeals() : []
    }).then((response) => {
      const result = response && response.result;
      if (!result || result.ok !== true || result.openid !== user.openid) {
        throw new Error("云端未确认写入");
      }
      return fetchDietData().then(verify);
    }).catch(() => ({ localOnly: false, message: `${readMessage} · 上传未验证` }));
  }).catch((error) => ({
    localOnly: true,
    message: error && error.message ? `云端读取失败：${error.message}` : "云端读取失败，显示本机记录"
  })).finally(() => {
    calendarRefreshPromise = null;
  });
  return calendarRefreshPromise;
}

function buildDietPayload(payload = {}) {
  const dailyMeals = payload.dailyMeals && typeof payload.dailyMeals === "object" ? payload.dailyMeals : diet.readDailyMealHistory();
  return {
    openid: payload.openid || "",
    profile: payload.profile || diet.readProfile(),
    foods: Array.isArray(payload.foods) ? payload.foods : diet.readFoodCatalog(),
    todayMeals: Array.isArray(payload.todayMeals) ? payload.todayMeals : diet.readTodayMeals(),
    dailyMeals,
    dailySummaries: {
      ...diet.readDailySummaries(),
      ...(payload.dailySummaries && typeof payload.dailySummaries === "object" ? payload.dailySummaries : {}),
      ...diet.buildDailySummaries(dailyMeals)
    },
    todayDate: diet.dateKey(),
    overwriteDates: diet.readDirtyMealDates(),
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
          if (cloudData.localOnly) {
            clearStoredUser();
            throw new Error(cloudData.message || "云端数据读取失败，请稍后重试");
          }
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
  const foodOnly = data.syncScope === "foods";
  if (!user && !foodOnly) {
    return Promise.resolve({ localOnly: true, message: "未登录，已保存在本机" });
  }
  if (!foodOnly) wx.setStorageSync("dietLastSyncPayload", data);
  return callCloudFunction("syncDietData", data)
    .then((result) => {
      const detail = result && result.result;
      if (!detail || detail.ok !== true || (user && user.openid && detail.openid !== user.openid)) {
        throw new Error("云端未确认写入");
      }
      if (!foodOnly) {
        const currentHistory = diet.readDailyMealHistory();
        const confirmedDates = data.overwriteDates.filter((date) =>
          JSON.stringify(currentHistory[date]) === JSON.stringify(data.dailyMeals[date]));
        diet.clearDirtyMealDates(confirmedDates);
      }
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
        detail
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
  logoutAndClearLocalHistory,
  queueSyncDietData,
  refreshCalendarHistory,
  syncDietData
};
