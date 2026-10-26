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
let todayMealsPage;
global.Page = (definition) => { todayMealsPage = definition; };
require("../miniprogram/pages/today-meals/today-meals.js");
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

test("editing catalog nutrition changes new meals but not saved meals or merged home totals", () => {
  storage.clear();
  const oldFood = { id: "rice", name: "米饭", unit: "g", coefficient: 1, carbs: 10, protein: 2, fat: 1, energy: 100 };
  const newFood = { ...oldFood, carbs: 20, protein: 3, fat: 2, energy: 150 };
  diet.saveFoodCatalog([oldFood]);
  diet.saveTodayMeals([{ id: "old", quantity: 100, food: oldFood }]);
  diet.saveFoodCatalog([newFood]);
  diet.saveTodayMeals([{ id: "new", quantity: 100, food: newFood }, ...diet.readTodayMeals()]);

  const page = {
    ...homePage,
    data: { ...homePage.data },
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    queueHomeRingDraw() {}
  };
  page.renderPage();
  assert.equal(diet.readTodayMeals()[1].food.carbs, 10);
  assert.equal(diet.readTodayMeals()[0].food.carbs, 20);
  assert.equal(page.data.homeMeals.length, 1);
  assert.equal(page.data.homeMeals[0].serving, "200g");
  assert.equal(page.data.homeMeals[0].carbs, "30.0");
  assert.equal(page.data.homeMeals[0].protein, "5.0");
  assert.equal(page.data.homeMeals[0].fat, "3.0");
  assert.equal(page.data.homeMeals[0].energy, "250 kcal");
  assert.equal(page.data.totalIntake, 250);
});

test("merged home rows reconcile with individual meal snapshots and both page totals", () => {
  storage.clear();
  const rice = { name: "米饭", unit: "g", coefficient: 1, carbs: 10, protein: 2, fat: 1, energy: 100 };
  const egg = { name: "鸡蛋", unit: "个", coefficient: 50, carbs: 0.6, protein: 6.3, fat: 5, energy: null };
  const juice = { name: "果汁", unit: "个", coefficient: 200, packageMl: 200, carbs: 20, protein: 0, fat: 0, energy: 80 };
  const meals = [
    { id: "rice-old", quantity: 100, food: rice },
    { id: "rice-new", quantity: 0.25, food: { ...rice, carbs: 20, protein: 4, fat: 2, energy: 150 } },
    { id: "egg", quantity: 0.25, food: egg },
    { id: "juice-half", quantity: 0.5, food: juice },
    { id: "juice-full", quantity: 1, food: juice },
    { id: "juice-other-size", quantity: 1, food: { ...juice, coefficient: 250, packageMl: 250, carbs: 25, energy: 100 } },
    { id: "milk", quantity: 25.5, food: { name: "牛奶", unit: "ml", coefficient: 1, carbs: 5, protein: 3, fat: 3, energy: null } }
  ];
  diet.saveTodayMeals(meals);
  const home = {
    ...homePage,
    data: { ...homePage.data },
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    queueHomeRingDraw() {}
  };
  const today = {
    ...todayMealsPage,
    data: {},
    setData(patch) { Object.assign(this.data, patch); }
  };
  const originalGroups = [
    ["rice-old", "rice-new"], ["egg"], ["juice-half", "juice-full"],
    ["juice-other-size"], ["milk"]
  ];
  const assertViewsMatch = (groups) => {
    const saved = diet.readTodayMeals();
    home.renderPage();
    today.renderSummary();
    const rows = today.formatMeals(saved);
    assert.equal(groups.flat().length, saved.length);
    rows.forEach((row, index) => {
      const intake = diet.mealIntake(saved[index]);
      assert.equal(row.energy, diet.formatEnergy(intake.kcal));
      for (const nutrient of ["carbs", "protein", "fat"]) {
        assert.equal(row[nutrient], diet.formatDecimal(intake[nutrient]));
      }
    });
    assert.equal(home.data.homeMeals.length, groups.length);
    groups.forEach((ids, index) => {
      const groupMeals = ids.map((id) => saved.find((meal) => meal.id === id));
      assert.ok(groupMeals.every(Boolean));
      const intake = diet.totalIntake(groupMeals);
      const row = home.data.homeMeals[index];
      assert.equal(row.energy, diet.formatEnergy(intake.kcal));
      for (const nutrient of ["carbs", "protein", "fat"]) {
        assert.equal(row[nutrient], diet.formatDecimal(intake[nutrient]));
      }
    });
    assert.equal(`${home.data.totalIntake} ${diet.readEnergyUnit()}`, today.data.summary.kcal);
    for (const nutrient of ["carbs", "protein", "fat"]) {
      const homeAmount = home.data.macros.find((macro) => macro.key === nutrient).amount.split(" / ")[0];
      assert.equal(`${homeAmount} g`, today.data.summary[nutrient]);
    }
  };

  assertViewsMatch(originalGroups);
  const riceRow = home.data.homeMeals.find((row) => row.name === "米饭");
  const riceIntake = diet.totalIntake(diet.readTodayMeals().filter((meal) => meal.id.startsWith("rice-")));
  assert.equal(riceRow.serving, "100.25g");
  assert.equal(riceRow.carbs, diet.formatDecimal(riceIntake.carbs));
  assert.equal(riceRow.protein, diet.formatDecimal(riceIntake.protein));
  assert.equal(riceRow.fat, diet.formatDecimal(riceIntake.fat));
  assert.equal(riceRow.energy, diet.formatEnergy(riceIntake.kcal));
  assert.deepEqual(home.data.homeMeals.filter((row) => row.name === "果汁").map((row) => row.serving), ["1.5个包装", "1个包装"]);

  diet.setStorage("dietEnergyUnit", "kJ");
  assertViewsMatch(originalGroups);
  diet.saveTodayMeals(diet.readTodayMeals().filter((meal) => meal.id !== "rice-old"));
  assertViewsMatch([["rice-new"], ...originalGroups.slice(1)]);
  diet.saveTodayMeals(meals, { fromCloud: true });
  assertViewsMatch(originalGroups);
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

test("home and today meals refresh another device's intake without opening the calendar", async () => {
  storage.clear();
  const today = diet.dateKey();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let remoteMeal = { id: "phone-meal", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 120 } };
  let reads = 0;
  wx.cloud = { callFunction: async ({ name }) => {
    assert.equal(name, "getDietData");
    reads += 1;
    return { result: {
      openid: "user-a", hasTodayData: true, todayMeals: [remoteMeal],
      dailyMeals: { [today]: [remoteMeal] },
      dailySummaries: { [today]: diet.buildDailySummary([remoteMeal]) }
    } };
  } };
  const home = {
    data: {},
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    renderPage() { this.shownMeals = diet.readTodayMeals().map((meal) => meal.id); }
  };
  await homePage.onShow.call(home);
  assert.deepEqual(home.shownMeals, ["phone-meal"]);

  remoteMeal = { ...remoteMeal, id: "developer-meal" };
  const mealsPage = {
    loadData() { this.shownMeals = diet.readTodayMeals().map((meal) => meal.id); },
    renderMealList(meals) { this.shownMeals = meals.map((meal) => meal.id); },
    renderSummary() {}
  };
  await todayMealsPage.onShow.call(mealsPage);
  assert.deepEqual(mealsPage.shownMeals, ["developer-meal"]);
  assert.equal(reads, 2);
});

test("automatic page refresh keeps unuploaded local meals", async () => {
  storage.clear();
  const today = diet.dateKey();
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 120 };
  const localMeal = { id: "local", quantity: 100, food };
  const remoteMeal = { id: "remote", quantity: 100, food };
  storage.set("dietUser", { openid: "user-a" });
  diet.saveTodayMeals([localMeal]);
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async ({ name }) => name === "syncDietData"
    ? { result: { ok: false, openid: "user-a" } }
    : { result: {
      openid: "user-a", hasTodayData: true, todayMeals: [remoteMeal],
      dailyMeals: { [today]: [remoteMeal] },
      dailySummaries: { [today]: diet.buildDailySummary([remoteMeal]) }
    } } };
  const home = {
    data: {},
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    renderPage() { this.shownMeals = diet.readTodayMeals().map((meal) => meal.id); }
  };
  await homePage.onShow.call(home);
  assert.deepEqual(home.shownMeals, ["local"]);
  assert.deepEqual(diet.readDirtyMealDates(), [today]);
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

test("confirmed same-day merge updates local records and clears its saved base", async () => {
  storage.clear();
  const today = diet.dateKey();
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 100 };
  const original = { id: "original", quantity: 100, food };
  const local = { id: "local", quantity: 100, food };
  const remote = { id: "remote", quantity: 100, food };
  diet.saveDailyMealHistory({ [today]: [original] });
  diet.saveTodayMeals([local, original]);
  assert.deepEqual(diet.readMealBases()[today].map((meal) => meal.id), ["original"]);
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  wx.cloud = { callFunction: async ({ name, data }) => {
    assert.equal(name, "syncDietData");
    assert.deepEqual(data.mealBases[today].map((meal) => meal.id), ["original"]);
    return { result: { ok: true, openid: "user-a", confirmedMeals: { [today]: [local, remote, original] } } };
  } };
  const result = await cloudSync.syncDietData();
  assert.equal(result.localOnly, false);
  assert.deepEqual(diet.readTodayMeals().map((meal) => meal.id), ["local", "remote", "original"]);
  assert.deepEqual(diet.readDirtyMealDates(), []);
  assert.equal(diet.readMealBases()[today], undefined);
  const home = {
    ...homePage,
    data: { ...homePage.data },
    setData(patch, done) { Object.assign(this.data, patch); if (done) done(); },
    queueHomeRingDraw() {}
  };
  const todayPage = {
    ...todayMealsPage,
    data: {},
    setData(patch) { Object.assign(this.data, patch); }
  };
  home.renderPage();
  todayPage.renderSummary();
  assert.equal(home.data.homeMeals.length, 1);
  assert.equal(home.data.homeMeals[0].energy, "300 kcal");
  assert.equal(todayPage.formatMeals(diet.readTodayMeals()).length, 3);
  assert.equal(`${home.data.totalIntake} kcal`, todayPage.data.summary.kcal);
});

test("deleting a newly added meal while its first upload is in flight records a tombstone", () => {
  storage.clear();
  const today = diet.dateKey();
  const meal = { id: "temporary", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 100 } };
  diet.saveTodayMeals([meal]);
  assert.deepEqual(diet.readMealBases()[today], []);
  diet.saveTodayMeals([]);
  assert.deepEqual(diet.readMealBases()[today].map((entry) => entry.id), ["temporary"]);
  assert.deepEqual(cloudSync.buildDietPayload().mealBases[today].map((entry) => entry.id), ["temporary"]);
});

test("calendar upload verifies and adopts a concurrent remote meal", async () => {
  storage.clear();
  const today = diet.dateKey();
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 100 };
  const local = { id: "local", quantity: 100, food };
  const remote = { id: "remote", quantity: 100, food };
  diet.saveTodayMeals([local]);
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let uploaded = false;
  wx.cloud = { callFunction: async ({ name, data }) => {
    if (name === "syncDietData") {
      assert.deepEqual(data.mealBases[today], []);
      uploaded = true;
      return { result: { ok: true, openid: "user-a", confirmedMeals: { [today]: [local, remote] } } };
    }
    const meals = uploaded ? [local, remote] : [remote];
    return { result: { openid: "user-a", hasTodayData: true, todayMeals: meals,
      dailyMeals: { [today]: meals }, dailySummaries: { [today]: diet.buildDailySummary(meals) } } };
  } };
  const result = await cloudSync.refreshCalendarHistory();
  assert.equal(result.verified, true);
  assert.deepEqual(diet.readTodayMeals().map((meal) => meal.id), ["local", "remote"]);
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

test("two same-day writes run in order even when the first cloud request is slow", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  const food = { name: "米饭", unit: "g", coefficient: 1, energy: 120 };
  const firstMeal = { id: "first", quantity: 100, food };
  const secondMeal = { id: "second", quantity: 100, food };
  const requests = [];
  const resolvers = [];
  wx.cloud = { callFunction: ({ name, data }) => {
    assert.equal(name, "syncDietData");
    requests.push(data);
    return new Promise((resolve) => resolvers.push(resolve));
  } };
  diet.saveTodayMeals([firstMeal]);
  const first = cloudSync.syncDietData();
  await Promise.resolve();
  diet.saveTodayMeals([secondMeal, firstMeal]);
  const second = cloudSync.syncDietData();
  await Promise.resolve();
  assert.equal(requests.length, 1);
  resolvers[0]({ result: { ok: true, openid: "user-a" } });
  await first;
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].todayMeals.map((meal) => meal.id), ["second", "first"]);
  resolvers[1]({ result: { ok: true, openid: "user-a" } });
  await second;
  assert.deepEqual(diet.readDirtyMealDates(), []);
});

test("pending meals retry after the application returns online", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  const today = diet.dateKey();
  const meal = { id: "retry", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 120 } };
  diet.saveTodayMeals([meal]);
  let remoteMeals = {};
  const calls = [];
  wx.cloud = { callFunction: async ({ name, data }) => {
    calls.push(name);
    if (name === "syncDietData") {
      remoteMeals = { ...remoteMeals, ...data.dailyMeals };
      return { result: { ok: true, openid: "user-a" } };
    }
    return { result: {
      openid: "user-a",
      dailyMeals: remoteMeals,
      dailySummaries: Object.fromEntries(Object.entries(remoteMeals).map(([date, meals]) => [date, diet.buildDailySummary(meals)]))
    } };
  } };
  await cloudSync.retryPendingSync();
  assert.deepEqual(calls, ["getDietData", "syncDietData", "getDietData"]);
  assert.equal(remoteMeals[today][0].id, "retry");
  assert.deepEqual(diet.readDirtyMealDates(), []);
});

test("app foreground and restored network both retry pending sync", async () => {
  const originalRetry = cloudSync.retryPendingSync;
  const originalRefresh = cloudSync.refreshCalendarHistory;
  const originalApp = global.App;
  const originalGetCurrentPages = global.getCurrentPages;
  let app;
  let networkStatusChange;
  let retries = 0;
  let refreshes = 0;
  let pageRefreshes = 0;
  cloudSync.retryPendingSync = async () => { retries += 1; };
  cloudSync.refreshCalendarHistory = async () => { refreshes += 1; return { localOnly: false }; };
  global.App = (definition) => { app = definition; };
  global.getCurrentPages = () => [{ refreshFromCloud() { pageRefreshes += 1; } }];
  wx.cloud = { init() {} };
  wx.onNetworkStatusChange = (listener) => { networkStatusChange = listener; };
  try {
    require("../miniprogram/app.js");
    app.onLaunch();
    app.onShow();
    networkStatusChange({ isConnected: false });
    networkStatusChange({ isConnected: true });
    await Promise.resolve();
    assert.equal(retries, 2);
    assert.equal(refreshes, 2);
    assert.equal(pageRefreshes, 1);
  } finally {
    cloudSync.retryPendingSync = originalRetry;
    cloudSync.refreshCalendarHistory = originalRefresh;
    global.App = originalApp;
    global.getCurrentPages = originalGetCurrentPages;
    delete wx.onNetworkStatusChange;
  }
});

test("a logged-out in-flight sync cannot clear the next session's pending date", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let complete;
  wx.cloud = { callFunction: () => new Promise((resolve) => { complete = resolve; }) };
  diet.saveTodayMeals([]);
  const pending = cloudSync.syncDietData();
  await Promise.resolve();
  cloudSync.logoutAndClearLocalHistory();
  storage.set("dietUser", { openid: "user-b" });
  diet.saveTodayMeals([]);
  complete({ result: { ok: true, openid: "user-a" } });
  await pending;
  assert.deepEqual(diet.readDirtyMealDates(), [diet.dateKey()]);
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

test("a new login does not reuse a calendar read from the previous session", async () => {
  storage.clear();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let finishOldRead;
  let reads = 0;
  wx.cloud = { callFunction: () => {
    reads += 1;
    if (reads === 1) return new Promise((resolve) => { finishOldRead = resolve; });
    return Promise.resolve({ result: { openid: "user-b", dailyMeals: {}, dailySummaries: {} } });
  } };
  const oldRequest = cloudSync.refreshCalendarHistory();
  cloudSync.logoutAndClearLocalHistory();
  storage.set("dietUser", { openid: "user-b" });
  const newRequest = cloudSync.refreshCalendarHistory();
  finishOldRead({ result: { openid: "user-a", dailyMeals: {}, dailySummaries: {} } });
  await Promise.all([oldRequest, newRequest]);
  assert.equal(reads, 2);
});

test("a pre-logout calendar response cannot populate a new session with the same account", async () => {
  storage.clear();
  const today = diet.dateKey();
  storage.set("dietUser", { openid: "user-a" });
  global.getApp = () => ({ globalData: { cloudReady: true } });
  let finishRead;
  wx.cloud = { callFunction: () => new Promise((resolve) => { finishRead = resolve; }) };
  const oldRequest = cloudSync.refreshCalendarHistory();
  cloudSync.logoutAndClearLocalHistory();
  storage.set("dietUser", { openid: "user-a" });
  const oldMeal = { id: "old-meal", quantity: 100, food: { name: "米饭", unit: "g", coefficient: 1, energy: 120 } };
  finishRead({ result: {
    openid: "user-a", hasTodayData: true, todayMeals: [oldMeal],
    dailyMeals: { [today]: [oldMeal] },
    dailySummaries: { [today]: diet.buildDailySummary([oldMeal]) }
  } });
  await oldRequest;
  assert.deepEqual(diet.readTodayMeals(), []);
});
