const USER_STORAGE_KEY = "dietUser";
const diet = require("./diet");

const syncTimers = {};
const pendingSyncPayloads = {};
let calendarRefreshState = null;
let profileRefreshState = null;
let cloudWriteTail = Promise.resolve();
let retryPromise = null;
let retryTimer = null;
let sessionEpoch = 0;

function queueCloudWrite(run) {
  const result = cloudWriteTail.then(run, run);
  cloudWriteTail = result.catch(() => {});
  return result;
}

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
    const user = wx.getStorageSync(USER_STORAGE_KEY);
    return user && user.openid ? user : null;
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
  sessionEpoch += 1;
  calendarRefreshState = null;
  profileRefreshState = null;
  retryPromise = null;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
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
    "dietMealBases",
    "dietDailyMeals",
    "dietDailySummaries",
    "dietLastSyncPayload",
    "dietProfile",
    "dietDayType",
    "dietEnergyUnit",
    "dietPendingProfileChanges"
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
    const openid = data.openid || data.OPENID;
    if (!openid) throw new Error("微信登录未返回 OpenID");
    return openid;
  });
}

function hasPendingSync() {
  const pendingFoods = wx.getStorageSync("dietPendingFoodMutations");
  const pendingProfile = wx.getStorageSync("dietPendingProfileChanges");
  const user = getStoredUser();
  return !!(user && user.openid && diet.readDirtyMealDates().length > 0)
    || !!(user && user.openid && pendingProfile && Object.keys(pendingProfile).length)
    || (Array.isArray(pendingFoods) && pendingFoods.length > 0)
    || !!wx.getStorageSync("dietFoodCatalogDirty");
}

function schedulePendingRetry() {
  if (retryTimer || !getCloudReady() || !hasPendingSync()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retryPendingSync();
  }, 15000);
  if (retryTimer && typeof retryTimer.unref === "function") retryTimer.unref();
}

function retryPendingSync() {
  if (retryPromise) return retryPromise;
  if (!getCloudReady()) return Promise.resolve([]);
  const tasks = [];
  const user = getStoredUser();
  if (user && user.openid && diet.readDirtyMealDates().length) {
    tasks.push(refreshCalendarHistory());
  }
  const pendingProfile = wx.getStorageSync("dietPendingProfileChanges");
  if (user && user.openid && pendingProfile && Object.keys(pendingProfile).length) {
    tasks.push(syncDietData({ syncScope: "profile", ...pendingProfile }));
  }
  const pendingFoods = wx.getStorageSync("dietPendingFoodMutations");
  if (wx.getStorageSync("dietFoodCatalogDirty")
    || (Array.isArray(pendingFoods) && pendingFoods.length)) {
    tasks.push(syncDietData({
      syncScope: "foods",
      foods: diet.readFoodCatalog(),
      foodMutations: Array.isArray(pendingFoods) ? pendingFoods : []
    }));
  }
  if (!tasks.length) return Promise.resolve([]);
  const request = Promise.all(tasks).finally(() => {
    if (retryPromise !== request) return;
    retryPromise = null;
    if (hasPendingSync()) schedulePendingRetry();
  });
  retryPromise = request;
  return retryPromise;
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

function applyConfirmedMealDates(sentMeals, confirmedMeals, dates) {
  const current = diet.readDailyMealHistory();
  const safeDates = dates.filter((date) => Array.isArray(confirmedMeals[date])
    && JSON.stringify(current[date]) === JSON.stringify(sentMeals[date]));
  if (!safeDates.length) return;
  const next = { ...current };
  safeDates.forEach((date) => { next[date] = confirmedMeals[date]; });
  diet.saveDailyMealHistory(next);
  const today = diet.dateKey();
  if (safeDates.includes(today)) diet.saveTodayMeals(confirmedMeals[today], { fromCloud: true });
  diet.clearDirtyMealDates(safeDates);
  if (typeof getCurrentPages === "function") {
    getCurrentPages().forEach((page) => {
      if (page && typeof page.refreshFromCloud === "function") page.refreshFromCloud();
    });
  }
}

function hydrateCloudProfile(cloudData) {
  const pending = wx.getStorageSync("dietPendingProfileChanges") || {};
  const localProfile = diet.readProfile();
  const remoteProfile = cloudData && cloudData.profile && typeof cloudData.profile === "object"
    ? cloudData.profile : null;
  const nextProfile = remoteProfile
    ? { ...localProfile, ...remoteProfile, ...(pending.profilePatch || {}) }
    : localProfile;
  const remoteUnit = cloudData && ["kcal", "kJ"].includes(cloudData.energyUnit)
    ? cloudData.energyUnit : "";
  const nextUnit = pending.energyUnitPatch || remoteUnit || diet.readEnergyUnit();
  const changed = Object.keys(nextProfile).some((key) => nextProfile[key] !== localProfile[key])
    || nextUnit !== diet.readEnergyUnit();
  if (!changed) return false;
  diet.saveProfile(nextProfile);
  diet.setStorage("dietEnergyUnit", nextUnit);
  if (typeof getCurrentPages === "function") {
    getCurrentPages().forEach((page) => {
      if (page && typeof page.refreshFromCloud === "function") page.refreshFromCloud();
    });
  }
  return true;
}

function refreshDietProfile() {
  const user = getStoredUser();
  if (!user || !user.openid) {
    return Promise.resolve({ localOnly: true, message: "登录后可同步个人资料" });
  }
  const epoch = sessionEpoch;
  if (profileRefreshState && profileRefreshState.epoch === epoch
    && profileRefreshState.openid === user.openid) return profileRefreshState.promise;
  const state = { epoch, openid: user.openid, promise: null };
  state.promise = callCloudFunction("getDietData", { scope: "profile" }).then((response) => {
    const current = getStoredUser();
    if (epoch !== sessionEpoch || !current || current.openid !== user.openid) {
      return { localOnly: true, message: "登录会话已变化" };
    }
    const result = response && response.result;
    if (!result || result.ok !== true || result.openid !== user.openid) {
      return { localOnly: true, message: "云端资料读取失败" };
    }
    return { localOnly: false, updated: hydrateCloudProfile(result) };
  }).catch((error) => ({
    localOnly: true,
    message: error && (error.errMsg || error.message) ? `云端资料读取失败：${error.errMsg || error.message}` : "云端资料读取失败"
  })).finally(() => {
    if (profileRefreshState === state) profileRefreshState = null;
  });
  profileRefreshState = state;
  return state.promise;
}

function refreshCalendarHistory(onRead) {
  const user = getStoredUser();
  if (!user || !user.openid) {
    return Promise.resolve({ localOnly: true, message: "登录后可跨设备同步日历" });
  }
  const epoch = sessionEpoch;
  if (calendarRefreshState && calendarRefreshState.epoch === epoch
    && calendarRefreshState.openid === user.openid) return calendarRefreshState.promise;
  const state = { epoch, openid: user.openid, promise: null };
  const sessionIsCurrent = () => {
    const currentUser = getStoredUser();
    return epoch === sessionEpoch && currentUser && currentUser.openid === user.openid;
  };
  const request = fetchDietData().then((cloudData) => {
    if (!sessionIsCurrent()) return { localOnly: true, message: "登录会话已变化" };
    if (cloudData.localOnly) {
      schedulePendingRetry();
      return cloudData;
    }
    if (cloudData.openid !== user.openid) {
      return { localOnly: true, message: "云端账号不一致，请重新登录" };
    }

    hydrateCloudProfile(cloudData);

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
    let expectedMeals = mergedMeals;
    let expectedSummaries = summaries;
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
      if (!sessionIsCurrent()) return { localOnly: true, message: "登录会话已变化" };
      if (verifiedData.localOnly || verifiedData.openid !== user.openid) {
        return { localOnly: false, message: `${readMessage} · 上传未验证` };
      }
      const verifiedMeals = verifiedData.dailyMeals || {};
      const verifiedSummaries = verifiedData.dailySummaries || {};
      const uploadedCount = localDates.filter((key) =>
        calendarRecordMatches(key, expectedMeals, expectedSummaries, verifiedMeals, verifiedSummaries)).length;
      const verifiedDirtyDates = dirtyDates.filter((date) =>
        calendarRecordMatches(date, expectedMeals, expectedSummaries, verifiedMeals, verifiedSummaries)
        && JSON.stringify(expectedMeals[date]) === JSON.stringify(verifiedMeals[date]));
      applyConfirmedMealDates(localMeals, expectedMeals, verifiedDirtyDates);
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
    return queueCloudWrite(() => {
      const current = getStoredUser();
      if (epoch !== sessionEpoch || !current || current.openid !== user.openid) {
        throw new Error("登录账号已变化");
      }
      return callCloudFunction("syncDietData", {
      syncScope: "calendar",
      dailyMeals: uploadMeals,
      dailySummaries: uploadSummaries,
      overwriteDates: dirtyDates.filter((date) => needsUpload.includes(date)),
      mealBases: diet.readMealBases(),
      todayDate: uploadToday ? today : "",
      todayMeals: uploadToday ? diet.readTodayMeals() : []
      });
    }).then((response) => {
      const result = response && response.result;
      if (!result || result.ok !== true || result.openid !== user.openid) {
        throw new Error("云端未确认写入");
      }
      if (result.confirmedMeals && typeof result.confirmedMeals === "object") {
        expectedMeals = { ...mergedMeals, ...result.confirmedMeals };
        expectedSummaries = { ...summaries, ...diet.buildDailySummaries(result.confirmedMeals) };
      }
      return fetchDietData().then(verify);
    }).catch(() => {
      if (sessionIsCurrent()) schedulePendingRetry();
      return { localOnly: false, message: `${readMessage} · 上传未验证` };
    });
  }).catch((error) => {
    if (sessionIsCurrent()) schedulePendingRetry();
    return {
      localOnly: true,
      message: error && error.message ? `云端读取失败：${error.message}` : "云端读取失败，显示本机记录"
    };
  }).finally(() => {
    if (calendarRefreshState === state) calendarRefreshState = null;
  });
  state.promise = request;
  calendarRefreshState = state;
  return request;
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
    mealBases: diet.readMealBases(),
    profilePatch: payload.profilePatch || {},
    energyUnitPatch: payload.energyUnitPatch || "",
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
          if (cloudData.openid !== openid) {
            clearStoredUser();
            throw new Error("云端账号与登录 OpenID 不一致");
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
  const epoch = sessionEpoch;
  const data = buildDietPayload({
    ...payload,
    openid: user && user.openid ? user.openid : ""
  });
  const foodOnly = data.syncScope === "foods";
  if (!user && !foodOnly) {
    return Promise.resolve({ localOnly: true, message: "未登录，已保存在本机" });
  }
  if (!foodOnly) wx.setStorageSync("dietLastSyncPayload", data);
  return queueCloudWrite(() => {
    const current = getStoredUser();
    if (epoch !== sessionEpoch || (!foodOnly && (!current || current.openid !== user.openid))) {
      throw new Error("登录账号已变化");
    }
    return callCloudFunction("syncDietData", data);
  })
    .then((result) => {
      const detail = result && result.result;
      if (!detail || detail.ok !== true || (user && user.openid && detail.openid !== user.openid)) {
        throw new Error("云端未确认写入");
      }
      if (epoch !== sessionEpoch) throw new Error("登录账号已变化");
      if (data.syncScope === "all" || data.syncScope === "meals" || data.syncScope === "calendar") {
        applyConfirmedMealDates(data.dailyMeals,
          detail.confirmedMeals && typeof detail.confirmedMeals === "object" ? detail.confirmedMeals : data.dailyMeals,
          data.overwriteDates);
      }
      if (data.syncScope === "profile") {
        const pending = wx.getStorageSync("dietPendingProfileChanges") || {};
        const remainingPatch = { ...(pending.profilePatch || {}) };
        Object.keys(data.profilePatch).forEach((key) => {
          if (remainingPatch[key] === data.profilePatch[key]) delete remainingPatch[key];
        });
        const remainingUnit = pending.energyUnitPatch === data.energyUnitPatch ? "" : pending.energyUnitPatch;
        if (Object.keys(remainingPatch).length || remainingUnit) {
          wx.setStorageSync("dietPendingProfileChanges", { profilePatch: remainingPatch, energyUnitPatch: remainingUnit });
        } else {
          wx.removeStorageSync("dietPendingProfileChanges");
        }
        hydrateCloudProfile(detail);
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
    .catch((error) => {
      if (epoch === sessionEpoch) schedulePendingRetry();
      return {
        localOnly: true,
        message: error && (error.errMsg || error.message) ? `云同步失败：${error.errMsg || error.message}` : "已保存在本机"
      };
    });
}

function queueSyncDietData(payload = {}, delay = 700) {
  const channel = payload.syncChannel || (payload.syncScope === "profile" ? "profile" : "diet");
  const previous = pendingSyncPayloads[channel] || {};
  if (payload.syncScope === "profile" && getStoredUser()) {
    const pending = wx.getStorageSync("dietPendingProfileChanges") || {};
    wx.setStorageSync("dietPendingProfileChanges", {
      profilePatch: { ...(pending.profilePatch || {}), ...(payload.profilePatch || {}) },
      energyUnitPatch: payload.energyUnitPatch || pending.energyUnitPatch || ""
    });
  }
  const foodMutations = [
    ...(Array.isArray(previous.foodMutations) ? previous.foodMutations : []),
    ...(previous.foodMutation ? [previous.foodMutation] : []),
    ...(Array.isArray(payload.foodMutations) ? payload.foodMutations : []),
    ...(payload.foodMutation ? [payload.foodMutation] : [])
  ].slice(-100);
  pendingSyncPayloads[channel] = {
    ...previous,
    ...payload,
    profilePatch: { ...(previous.profilePatch || {}), ...(payload.profilePatch || {}) },
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
  refreshDietProfile,
  refreshCalendarHistory,
  retryPendingSync,
  syncDietData
};
