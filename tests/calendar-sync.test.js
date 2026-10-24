const assert = require("node:assert/strict");
const test = require("node:test");

const storage = new Map();
global.wx = {
  getStorageSync: (key) => storage.has(key) ? storage.get(key) : "",
  setStorageSync: (key, value) => storage.set(key, value),
  removeStorageSync: (key) => storage.delete(key)
};

const diet = require("../miniprogram/utils/diet");
const cloudSync = require("../miniprogram/utils/cloud-sync");
let homePage;
global.Page = (definition) => { homePage = definition; };
require("../miniprogram/pages/home/home.js");
let settingsPage;
global.Page = (definition) => { settingsPage = definition; };
require("../miniprogram/pages/settings/settings.js");

test("summary-only energy survives local meal history updates and enters the cloud payload", () => {
  storage.clear();
  diet.saveDailySummaries({
    "2026-10-20": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 }
  });
  diet.saveDailyMealHistory({ "2026-10-21": [] });
  assert.equal(diet.readDailySummaries()["2026-10-20"].kcal, 350);
  const payload = cloudSync.buildDietPayload();
  assert.equal(payload.dailySummaries["2026-10-20"].kcal, 350);
  assert.equal(payload.dailySummaries["2026-10-21"].kcal, 0);
});

test("calendar displays restored energy when meal details are unavailable", () => {
  storage.clear();
  diet.saveDailySummaries({
    "2026-10-20": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 }
  });
  const summary = homePage.dailySummary.call({
    data: { dayType: "training" },
    mealsForDate: () => []
  }, "2026-10-20");
  assert.equal(summary.hasData, true);
  assert.equal(summary.mealCount, 2);
  assert.equal(summary.intake.kcal, 350);
});

test("login restores cloud calendar summaries and uploads merged local history", async () => {
  storage.clear();
  wx.showToast = () => {};
  diet.saveDailySummaries({
    "2026-10-19": { kcal: 200, carbs: 10, protein: 10, fat: 10, mealCount: 1 }
  });
  const originalLogin = cloudSync.loginWithWechat;
  const originalSync = cloudSync.syncDietData;
  let uploaded;
  cloudSync.loginWithWechat = async () => ({
    user: { name: "微信用户", openid: "user-a" },
    syncResult: { message: "已从云端加载数据" },
    cloudData: {
      hasMealData: true,
      dailyMeals: {},
      dailySummaries: {
        "2026-10-20": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 }
      }
    }
  });
  cloudSync.syncDietData = async () => {
    uploaded = cloudSync.buildDietPayload();
    return { message: "已同步到后台" };
  };
  const page = {
    data: { profile: diet.readProfile(), predictionReady: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    await settingsPage.loginWithWechat.call(page);
  } finally {
    cloudSync.loginWithWechat = originalLogin;
    cloudSync.syncDietData = originalSync;
  }
  assert.equal(uploaded.dailySummaries["2026-10-19"].kcal, 200);
  assert.equal(uploaded.dailySummaries["2026-10-20"].kcal, 350);
  assert.equal(diet.readDailySummaries()["2026-10-20"].kcal, 350);
});

test("login keeps an unsynced local meal instead of replacing it with older cloud data", async () => {
  storage.clear();
  wx.showToast = () => {};
  const today = diet.dateKey();
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 120 };
  const local = { id: "local", quantity: 100, food };
  const remote = { id: "remote", quantity: 100, food };
  diet.saveTodayMeals([local]);
  const originalLogin = cloudSync.loginWithWechat;
  const originalSync = cloudSync.syncDietData;
  let uploaded;
  cloudSync.loginWithWechat = async () => ({
    user: { name: "微信用户", openid: "user-a" },
    syncResult: { message: "已从云端加载数据" },
    cloudData: {
      hasMealData: true,
      hasTodayData: true,
      todayMeals: [remote],
      dailyMeals: { [today]: [remote] },
      dailySummaries: { [today]: diet.buildDailySummary([remote]) }
    }
  });
  cloudSync.syncDietData = async () => {
    uploaded = cloudSync.buildDietPayload();
    return { message: "已同步到后台" };
  };
  const page = {
    data: { profile: diet.readProfile(), predictionReady: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    await settingsPage.loginWithWechat.call(page);
  } finally {
    cloudSync.loginWithWechat = originalLogin;
    cloudSync.syncDietData = originalSync;
  }
  assert.equal(diet.readTodayMeals()[0].id, "local");
  assert.equal(uploaded.todayMeals[0].id, "local");
  assert.ok(uploaded.overwriteDates.includes(today));
});

test("editing today does not discard yesterday's pending upload", () => {
  storage.clear();
  const yesterday = diet.dateKey(diet.addDays(new Date(), -1));
  storage.set("dietDailyMeals", { [yesterday]: [] });
  storage.set("dietTodayMealsDirtyDate", yesterday);
  diet.saveTodayMeals([]);
  assert.deepEqual(diet.readDirtyMealDates().sort(), [yesterday, diet.dateKey()].sort());
  assert.deepEqual(cloudSync.buildDietPayload().overwriteDates.sort(), [yesterday, diet.dateKey()].sort());
});

test("login preserves a pending meal from yesterday for upload", async () => {
  storage.clear();
  wx.showToast = () => {};
  const yesterday = diet.dateKey(diet.addDays(new Date(), -1));
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 120 };
  const local = { id: "local", quantity: 100, food };
  const remote = { id: "remote", quantity: 100, food };
  diet.saveDailyMealHistory({ [yesterday]: [local] });
  storage.set("dietTodayMealsDirtyDate", yesterday);
  const originalLogin = cloudSync.loginWithWechat;
  const originalSync = cloudSync.syncDietData;
  let uploaded;
  cloudSync.loginWithWechat = async () => ({
    user: { name: "微信用户", openid: "user-a" },
    syncResult: { message: "已从云端加载数据" },
    cloudData: {
      hasMealData: true,
      dailyMeals: { [yesterday]: [remote] },
      dailySummaries: { [yesterday]: diet.buildDailySummary([remote]) }
    }
  });
  cloudSync.syncDietData = async () => {
    uploaded = cloudSync.buildDietPayload();
    return { message: "已同步到后台" };
  };
  const page = {
    data: { profile: diet.readProfile(), predictionReady: false },
    setData(patch) { Object.assign(this.data, patch); }
  };
  try {
    await settingsPage.loginWithWechat.call(page);
  } finally {
    cloudSync.loginWithWechat = originalLogin;
    cloudSync.syncDietData = originalSync;
  }
  assert.equal(diet.readDailyMealHistory()[yesterday][0].id, "local");
  assert.equal(uploaded.dailyMeals[yesterday][0].id, "local");
  assert.ok(uploaded.overwriteDates.includes(yesterday));
});

test("opening the calendar fetches another device's records for the same account", async () => {
  storage.clear();
  const today = diet.dateKey();
  const yesterday = diet.dateKey(diet.addDays(new Date(), -1));
  const meal = { id: "remote-meal", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 120, carbs: 20, protein: 5, fat: 2 } };
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = {
    callFunction: async ({ name }) => {
      assert.equal(name, "getDietData");
      return { result: {
        openid: "user-a",
        hasTodayData: true,
        todayMeals: [meal],
        dailyMeals: { [yesterday]: [meal], [today]: [meal] },
        dailySummaries: { [yesterday]: diet.buildDailySummary([meal]), [today]: diet.buildDailySummary([meal]) }
      } };
    }
  };
  const page = {
    data: { calendarVisible: false },
    setData(patch) { Object.assign(this.data, patch); },
    renderCalendar() { this.renderCount = (this.renderCount || 0) + 1; },
    renderPage() { this.renderCount += 1; }
  };
  await homePage.openCalendar.call(page);
  assert.equal(diet.readDailyMealHistory()[yesterday].length, 1);
  assert.equal(diet.readTodayMeals().length, 1);
  assert.equal(page.data.calendarSyncText, "云端已读取 2 天记录 · 已上传 2 天记录");
  assert.equal(page.renderCount, 3);
});

test("calendar only shows uploaded count after cloud write and read-back agree", async () => {
  storage.clear();
  const day = "2026-10-20";
  const summary = { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 };
  diet.saveDailySummaries({ [day]: summary });
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let cloudSummary = {};
  const calls = [];
  wx.cloud = { callFunction: async ({ name, data }) => {
    calls.push(name);
    if (name === "syncDietData") {
      assert.equal(data.syncScope, "calendar");
      cloudSummary = data.dailySummaries;
      return { result: { ok: true, openid: "user-a" } };
    }
    return { result: { openid: "user-a", dailyMeals: {}, dailySummaries: cloudSummary } };
  } };
  const messages = [];
  const result = await cloudSync.refreshCalendarHistory((progress) => messages.push(progress.message));
  assert.deepEqual(calls, ["getDietData", "syncDietData", "getDietData"]);
  assert.deepEqual(messages, ["云端已读取 0 天记录"]);
  assert.equal(result.message, "云端已读取 0 天记录 · 已上传 1 天记录");
});

test("historical dirty date clears only after cloud read-back matches", async () => {
  storage.clear();
  const yesterday = diet.dateKey(diet.addDays(new Date(), -1));
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 120 };
  const local = { id: "local", quantity: 100, food };
  const remote = { id: "remote", quantity: 100, food };
  diet.saveDailyMealHistory({ [yesterday]: [local] });
  storage.set("dietTodayMealsDirtyDate", yesterday);
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let cloudMeal = remote;
  wx.cloud = { callFunction: async ({ name, data }) => {
    if (name === "syncDietData") {
      assert.deepEqual(data.overwriteDates, [yesterday]);
      cloudMeal = data.dailyMeals[yesterday][0];
      return { result: { ok: true, openid: "user-a" } };
    }
    return { result: {
      openid: "user-a",
      dailyMeals: { [yesterday]: [cloudMeal] },
      dailySummaries: { [yesterday]: diet.buildDailySummary([cloudMeal]) }
    } };
  } };
  const result = await cloudSync.refreshCalendarHistory();
  assert.equal(result.verified, true);
  assert.equal(cloudMeal.id, "local");
  assert.deepEqual(diet.readDirtyMealDates(), []);
});

test("a soft cloud failure does not clear pending meal dates", async () => {
  storage.clear();
  const today = diet.dateKey();
  storage.set("dietUser", { openid: "user-a" });
  diet.saveTodayMeals([]);
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async () => ({ result: { ok: false, openid: "user-a" } }) };
  const result = await cloudSync.syncDietData();
  assert.equal(result.localOnly, true);
  assert.deepEqual(diet.readDirtyMealDates(), [today]);
});

test("calendar does not claim uploaded days when read-back is missing", async () => {
  storage.clear();
  diet.saveDailySummaries({ "2026-10-20": { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 } });
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async ({ name }) => name === "syncDietData"
    ? { result: { ok: true, openid: "user-a" } }
    : { result: { openid: "user-a", dailyMeals: {}, dailySummaries: {} } } };
  const result = await cloudSync.refreshCalendarHistory();
  assert.equal(result.verified, false);
  assert.equal(result.message, "云端已读取 0 天记录 · 已核对 0/1 天，上传待确认");
});

test("cloud refresh does not restore a locally cleared day before it uploads", async () => {
  storage.clear();
  const today = diet.dateKey();
  const meal = { id: "remote-meal", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 120, carbs: 20, protein: 5, fat: 2 } };
  storage.set("dietUser", { openid: "user-a" });
  diet.saveTodayMeals([]);
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async () => ({ result: {
    openid: "user-a", hasTodayData: true, todayMeals: [meal],
    dailyMeals: { [today]: [meal] }, dailySummaries: { [today]: diet.buildDailySummary([meal]) }
  } }) };
  await cloudSync.refreshCalendarHistory();
  assert.equal(diet.readTodayMeals().length, 0);
  assert.equal(diet.readDailySummaries()[today].kcal, 0);
  assert.equal(storage.get("dietTodayMealsDirtyDate"), today);
});

test("calendar refresh refuses data from a different cloud account", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async () => ({ result: {
    openid: "user-b",
    dailySummaries: { "2026-10-20": { kcal: 350, mealCount: 1 } }
  } }) };
  const result = await cloudSync.refreshCalendarHistory();
  assert.equal(result.localOnly, true);
  assert.match(result.message, /账号不一致/);
  assert.equal(diet.readDailySummaries()["2026-10-20"], undefined);
});

test("logging out removes downloaded calendar and today meals from this device", async () => {
  storage.clear();
  const day = "2026-10-20";
  const summary = { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 };
  storage.set("dietUser", { openid: "user-a" });
  diet.saveProfile({ ...diet.readProfile(), weight: 61.2345 });
  storage.set("dietEnergyUnit", "kJ");
  storage.set("dietDayType", "rest");
  diet.saveDailySummaries({ [day]: summary });
  storage.set("dietLastSyncPayload", { dailySummaries: { [day]: summary } });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async () => ({ result: {
    openid: "user-a", dailyMeals: {}, dailySummaries: { [day]: summary }
  } }) };
  wx.showModal = () => { throw new Error("verified logout must not prompt"); };
  const page = {
    data: { user: { loggedIn: true }, loginButtonText: "退出" },
    setData(patch) { Object.assign(this.data, patch); }
  };
  await settingsPage.toggleLogin.call(page);
  assert.equal(storage.has("dietUser"), false);
  for (const key of ["dietDailyMeals", "dietDailySummaries", "dietTodayMeals", "dietLastSyncPayload", "dietProfile", "dietEnergyUnit", "dietDayType"]) {
    assert.equal(storage.has(key), false);
  }
  assert.equal(diet.readDailySummaries()[day], undefined);
  assert.equal(diet.readProfile().weight, 75);
  assert.equal(page.data.weightInput, "75");
  assert.equal(page.data.user.loggedIn, false);
});

test("logout can be cancelled if cloud history was not verified", async () => {
  storage.clear();
  const day = "2026-10-20";
  const summary = { kcal: 350, carbs: 20, protein: 10, fat: 20, mealCount: 2 };
  storage.set("dietUser", { openid: "user-a" });
  diet.saveDailySummaries({ [day]: summary });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async ({ name }) => name === "syncDietData"
    ? { result: { ok: true, openid: "user-a" } }
    : { result: { openid: "user-a", dailyMeals: {}, dailySummaries: {} } } };
  wx.showModal = ({ success }) => success({ confirm: false });
  const page = {
    data: { user: { loggedIn: true }, loginButtonText: "退出" },
    setData(patch) { Object.assign(this.data, patch); }
  };
  await settingsPage.toggleLogin.call(page);
  assert.equal(storage.has("dietUser"), true);
  assert.equal(diet.readDailySummaries()[day].kcal, 350);
  assert.equal(page.data.loginButtonText, "退出");
});

test("an in-flight calendar read cannot restore records after logout", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let completeRead;
  wx.cloud = { callFunction: () => new Promise((resolve) => { completeRead = resolve; }) };
  const pending = cloudSync.refreshCalendarHistory();
  cloudSync.logoutAndClearLocalHistory();
  completeRead({ result: {
    openid: "user-a",
    dailySummaries: { "2026-10-20": { kcal: 350, mealCount: 1 } }
  } });
  await pending;
  assert.deepEqual(diet.readDailySummaries(), {});
  assert.equal(storage.has("dietUser"), false);
  await cloudSync.syncDietData({ dailySummaries: { "2026-10-20": { kcal: 350 } } });
  assert.equal(storage.has("dietLastSyncPayload"), false);
});
