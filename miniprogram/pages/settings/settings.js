const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");

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
  },

  toggleLogin() {
    if (this.data.user.loggedIn) {
      cloudSync.clearStoredUser();
      this.setData({
        user: { loggedIn: false },
        loginButtonText: "微信登录",
        loginStatus: "",
        showLoginBody: false,
        showLoginEmpty: true
      });
      return;
    }
    this.loginWithWechat();
  },

  loginWithWechat() {
    this.setData({ loginButtonText: "登录中", loginStatus: "正在调用微信登录..." });
    cloudSync.loginWithWechat({
      profile: this.data.profile,
      foods: diet.readFoodCatalog(),
      todayMeals: diet.readTodayMeals(),
      dailyMeals: diet.readDailyMealHistory(),
      dailySummaries: diet.buildDailySummaries(),
      energyUnit: diet.readEnergyUnit()
    }).then(({ user, syncResult, cloudData }) => {
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
        diet.saveDailyMealHistory({ ...diet.readDailyMealHistory(), ...cloudDailyMeals });
      }
      if (cloudDailySummaries) {
        diet.saveDailySummaries({ ...diet.readDailySummaries(), ...cloudDailySummaries });
      }
      if (cloudData && cloudData.hasTodayData && cloudTodayMeals) diet.saveTodayMeals(cloudTodayMeals);
      if (cloudEnergyUnit) diet.setStorage("dietEnergyUnit", cloudEnergyUnit);
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
    }).catch(() => {
      this.setData({
        loginButtonText: "微信登录",
        loginStatus: "微信登录失败，请稍后重试"
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
    const weightInput = event.detail.value || "";
    const weight = Number(weightInput);
    if (!weightInput || !Number.isFinite(weight)) {
      this.setData({ weightInput });
      return;
    }
    this.updateProfile({ weight }, { weightInput });
  },

  blurWeight() {
    this.setData({ weightInput: String(this.data.profile.weight) });
  },

  updateProfile(patch, extra = {}) {
    const profile = { ...this.data.profile, ...patch };
    diet.saveProfile(profile);
    this.setData({ profile, ...extra });
    cloudSync.queueSyncDietData({
      profile,
      foods: diet.readFoodCatalog(),
      todayMeals: diet.readTodayMeals(),
      dailyMeals: diet.readDailyMealHistory(),
      dailySummaries: diet.buildDailySummaries(),
      energyUnit: diet.readEnergyUnit()
    });
  },

  predict() {
    this.setData({
      predictionReady: true,
      showPredictionEmpty: false,
      showPredictionResult: true
    });
    this.renderPrediction();
    if (wx.vibrateShort) {
      wx.vibrateShort({ type: "light" });
    }
    wx.showToast({
      title: "预测完成",
      icon: "success",
      duration: 1200
    });
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
