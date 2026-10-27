const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");
const PROFILE_REFRESH_MS = 15000;

Page({
  data: {
    profile: {},
    weightInput: "",
    sexLabels: ["男", "女"],
    sexIndex: 0,
    sexLabel: "男",
    planLabels: ["增肌", "减脂"],
    planIndex: 0,
    planLabel: "增肌",
    predictionReady: false,
    resultDay: "training",
    resultDayLabel: "力训日",
    result: {},
    details: {},
    detailsOpen: false,
    detailsToggleClass: "detail-toggle",
    trainingResultActive: "active",
    restResultActive: "",
    showPredictionEmpty: true,
    showPredictionResult: false,
    loginButtonText: "微信登录",
    loginStatus: "",
    showLoginBody: false,
    showLoginEmpty: true,
    user: { loggedIn: false }
  },

  onShow() {
    const viewEpoch = this.viewEpoch = (this.viewEpoch || 0) + 1;
    this.stopProfileRefresh();
    const profile = diet.readProfile();
    const resultDay = wx.getStorageSync("dietDayType") || "training";
    const user = cloudSync.getStoredUser();
    const userData = user ? { ...user, loggedIn: true, initial: String(user.name || "?").slice(0, 1) } : { loggedIn: false };
    this.setData({
      profile,
      weightInput: String(profile.weight),
      resultDay,
      sexIndex: profile.sex === "female" ? 1 : 0,
      sexLabel: profile.sex === "female" ? "女" : "男",
      planIndex: profile.plan === "loss" ? 1 : 0,
      planLabel: profile.plan === "loss" ? "减脂" : "增肌",
      user: userData,
      loginButtonText: user ? "退出" : "微信登录",
      showLoginBody: !!user,
      showLoginEmpty: !user,
      trainingResultActive: resultDay === "training" ? "active" : "",
      restResultActive: resultDay === "rest" ? "active" : "",
      showPredictionEmpty: !this.data.predictionReady,
      showPredictionResult: this.data.predictionReady
    });
    if (this.data.predictionReady) this.renderPrediction();
    if (!user) return Promise.resolve();
    this.startProfileRefresh(user.openid, viewEpoch);
    return cloudSync.refreshCalendarHistory().then((result) => {
      if (this.viewEpoch === viewEpoch && !result.localOnly) this.refreshFromCloud();
    });
  },

  onHide() {
    this.viewEpoch = (this.viewEpoch || 0) + 1;
    this.stopProfileRefresh();
    this.profileInputFocused = false;
  },

  onUnload() {
    this.stopProfileRefresh();
  },

  startProfileRefresh(openid, viewEpoch) {
    this.profileRefreshTimer = setInterval(() => {
      const user = cloudSync.getStoredUser();
      if (this.viewEpoch !== viewEpoch || !user || user.openid !== openid) return;
      cloudSync.refreshDietProfile().then((result) => {
        if (this.viewEpoch !== viewEpoch) return;
        if (result.localOnly) {
          this.setData({ loginStatus: result.message || "个人资料同步失败" });
          return;
        }
        if (result.updated) this.refreshFromCloud();
        if (result.updated || String(this.data.loginStatus || "").includes("失败")) {
          this.setData({ loginStatus: "个人资料已从云端同步" });
        }
      });
    }, PROFILE_REFRESH_MS);
    if (this.profileRefreshTimer && typeof this.profileRefreshTimer.unref === "function") {
      this.profileRefreshTimer.unref();
    }
  },

  stopProfileRefresh() {
    if (this.profileRefreshTimer) clearInterval(this.profileRefreshTimer);
    this.profileRefreshTimer = null;
  },

  refreshFromCloud() {
    if (this.profileInputFocused) return;
    const profile = diet.readProfile();
    this.setData({
      profile,
      weightInput: String(profile.weight),
      sexIndex: profile.sex === "female" ? 1 : 0,
      sexLabel: profile.sex === "female" ? "女" : "男",
      planIndex: profile.plan === "loss" ? 1 : 0,
      planLabel: profile.plan === "loss" ? "减脂" : "增肌"
    });
    if (this.data.predictionReady) this.renderPrediction();
  },

  beginProfileEdit() {
    this.profileInputFocused = true;
  },

  endProfileEdit() {
    this.profileInputFocused = false;
    this.refreshFromCloud();
  },

  async toggleLogin() {
    if (this.data.user.loggedIn) {
      if (this.data.loginButtonText === "退出中") return;
      this.setData({ loginButtonText: "退出中" });
      const result = await cloudSync.refreshCalendarHistory();
      if (!result.verified) {
        const confirmed = await new Promise((resolve) => {
          wx.showModal({
            title: "日历尚未确认同步",
            content: "退出会清除本机餐食和日历记录，未上传的内容可能丢失。仍要退出吗？",
            confirmText: "仍要退出",
            cancelText: "取消",
            success: (response) => resolve(!!response.confirm),
            fail: () => resolve(false)
          });
        });
        if (!confirmed) {
          this.setData({ loginButtonText: "退出", loginStatus: result.message || "云端尚未确认同步" });
          return;
        }
      }
      cloudSync.logoutAndClearLocalHistory();
      this.stopProfileRefresh();
      const profile = diet.readProfile();
      this.setData({
        profile,
        weightInput: String(profile.weight),
        sexIndex: profile.sex === "female" ? 1 : 0,
        sexLabel: profile.sex === "female" ? "女" : "男",
        planIndex: profile.plan === "loss" ? 1 : 0,
        planLabel: profile.plan === "loss" ? "减脂" : "增肌",
        resultDay: "training",
        trainingResultActive: "active",
        restResultActive: "",
        predictionReady: false,
        showPredictionEmpty: true,
        showPredictionResult: false,
        user: { loggedIn: false },
        loginButtonText: "微信登录",
        loginStatus: "",
        showLoginBody: false,
        showLoginEmpty: true
      });
      return;
    }
    return this.loginWithWechat();
  },

  loginWithWechat() {
    this.setData({ loginButtonText: "登录中", loginStatus: "正在调用微信登录..." });
    return cloudSync.loginWithWechat({
      profile: this.data.profile,
      foods: diet.readFoodCatalog(),
      todayMeals: diet.readTodayMeals(),
      dailyMeals: diet.readDailyMealHistory(),
      dailySummaries: diet.buildDailySummaries(),
      energyUnit: diet.readEnergyUnit()
    }).then(async ({ user, syncResult, cloudData }) => {
      const today = diet.dateKey();
      const dirtyDates = diet.readDirtyMealDates();
      const localMeals = diet.readDailyMealHistory();
      const pendingTodayMeals = dirtyDates.includes(today) ? diet.readTodayMeals() : null;
      const cloudProfile = cloudData && cloudData.profile ? cloudData.profile : null;
      const cloudFoods = cloudData && Array.isArray(cloudData.foods) ? cloudData.foods : null;
      const cloudTodayMeals = cloudData && Array.isArray(cloudData.todayMeals) ? cloudData.todayMeals : null;
      const cloudDailyMeals = cloudData && cloudData.dailyMeals ? cloudData.dailyMeals : null;
      const cloudDailySummaries = cloudData && cloudData.dailySummaries ? cloudData.dailySummaries : null;
      const cloudEnergyUnit = cloudData && (cloudData.energyUnit === "kcal" || cloudData.energyUnit === "kJ") ? cloudData.energyUnit : "";
      const profile = cloudProfile ? { ...diet.readProfile(), ...cloudProfile } : this.data.profile;
      if (cloudProfile) diet.saveProfile(profile);
      if (cloudData && cloudData.hasFoodData && cloudFoods) diet.saveFoodCatalog(cloudFoods);
      if (cloudData && cloudData.hasMealData && cloudDailyMeals) {
        const mergedMeals = { ...localMeals, ...cloudDailyMeals };
        dirtyDates.forEach((date) => {
          if (Object.prototype.hasOwnProperty.call(localMeals, date)) mergedMeals[date] = localMeals[date];
        });
        if (pendingTodayMeals) mergedMeals[today] = pendingTodayMeals;
        diet.saveDailyMealHistory(mergedMeals);
      }
      if (cloudDailySummaries) {
        diet.saveDailySummaries({
          ...diet.readDailySummaries(),
          ...cloudDailySummaries,
          ...diet.buildDailySummaries()
        });
      }
      if (cloudData && cloudData.hasTodayData && cloudTodayMeals && !pendingTodayMeals) {
        diet.saveTodayMeals(cloudTodayMeals, { fromCloud: true });
      }
      if (cloudEnergyUnit) diet.setStorage("dietEnergyUnit", cloudEnergyUnit);
      if (cloudData) syncResult = await cloudSync.syncDietData({
        syncScope: cloudData.hasProfileData ? "meals" : "all"
      });
      this.setData({
        profile,
        weightInput: String(profile.weight),
        sexIndex: profile.sex === "female" ? 1 : 0,
        sexLabel: profile.sex === "female" ? "女" : "男",
        planIndex: profile.plan === "loss" ? 1 : 0,
        planLabel: profile.plan === "loss" ? "减脂" : "增肌",
        user: { ...user, loggedIn: true, initial: String(user.name).slice(0, 1) },
        loginButtonText: "退出",
        loginStatus: syncResult.message,
        showLoginBody: true,
        showLoginEmpty: false
      });
      if (this.data.predictionReady) this.renderPrediction();
      wx.showToast({ title: "登录成功", icon: "success" });
    }).catch((error) => {
      this.setData({
        loginButtonText: "微信登录",
        loginStatus: error && error.message ? `登录未完成：${error.message}` : "微信登录失败，请稍后重试"
      });
    });
  },

  changeSex(event) {
    const sexIndex = Number(event.detail.value || 0);
    this.updateProfile({ sex: sexIndex === 1 ? "female" : "male" }, { sexIndex, sexLabel: sexIndex === 1 ? "女" : "男" });
  },

  changePlan(event) {
    const planIndex = Number(event.detail.value || 0);
    this.updateProfile({ plan: planIndex === 1 ? "loss" : "gain" }, { planIndex, planLabel: planIndex === 1 ? "减脂" : "增肌" });
  },

  inputProfile(event) {
    const field = event.currentTarget.dataset.field;
    this.updateProfile({ [field]: Number(event.detail.value || 0) });
  },

  inputWeight(event) {
    const weightInput = event.detail.value;
    if (!/^\d*(?:\.\d{0,4})?$/.test(weightInput)) return this.data.weightInput;

    const weight = Number(weightInput);
    if (weightInput === "" || weightInput === "." || !Number.isFinite(weight)) {
      this.setData({ weightInput });
    } else if (weight !== this.data.profile.weight) {
      this.updateProfile({ weight }, { weightInput });
    } else {
      this.setData({ weightInput });
    }
    return weightInput;
  },

  blurWeight() {
    this.endProfileEdit();
  },

  updateProfile(patch, extra = {}) {
    const profile = { ...this.data.profile, ...patch };
    diet.saveProfile(profile);
    this.setData({ profile, ...extra });
    cloudSync.queueSyncDietData({
      syncScope: "profile",
      profilePatch: patch
    });
  },

  predict() {
    this.setData({
      predictionReady: true,
      showPredictionEmpty: false,
      showPredictionResult: true
    });
    this.renderPrediction();
  },

  changeResultDay(event) {
    const resultDay = event.currentTarget.dataset.day;
    wx.setStorageSync("dietDayType", resultDay);
    this.setData({
      resultDay,
      trainingResultActive: resultDay === "training" ? "active" : "",
      restResultActive: resultDay === "rest" ? "active" : ""
    });
    if (this.data.predictionReady) this.renderPrediction();
  },

  toggleDetails() {
    const detailsOpen = !this.data.detailsOpen;
    this.setData({
      detailsOpen,
      detailsToggleClass: detailsOpen ? "detail-toggle is-open" : "detail-toggle"
    });
  },

  renderPrediction() {
    const unit = diet.readEnergyUnit();
    const targets = diet.calculateTargets(this.data.profile);
    const resultDay = this.data.resultDay;
    const resultDayLabel = resultDay === "training" ? "力训日" : "休息日";
    const calories = resultDay === "training" ? targets.f1 : targets.f2;
    const balanced = resultDay === "training" ? targets.e1 : targets.e2;
    const macros = diet.macroTargets(calories, this.data.profile, resultDay);
    this.setData({
      resultDayLabel,
      result: {
        energy: diet.formatEnergy(calories, unit),
        energyNumber: diet.round(diet.energyValue(calories, unit)),
        energyUnit: unit,
        carbs: `${diet.round(macros.carbs)}g`,
        protein: `${diet.round(macros.protein)}g`,
        fat: `${diet.round(macros.fat)}g`
      },
      details: {
        bmr: diet.formatEnergy(targets.a, unit),
        noExercise: diet.formatEnergy(targets.b, unit),
        balanced: diet.formatEnergy(balanced, unit),
        target: diet.formatEnergy(calories, unit)
      }
    });
  }
});
