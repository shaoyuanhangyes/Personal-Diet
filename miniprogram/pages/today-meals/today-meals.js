const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");
const MEAL_PAGE_SIZE = 5;

Page({
  data: {
    foods: [],
    foodNames: [],
    selectedIndex: 0,
    selectedFoodLabel: "请选择食物",
    quantity: "",
    servingPreview: "",
    summary: { kcal: "0 kcal", carbs: "0 g", protein: "0 g", fat: "0 g" },
    meals: [],
    hasMeals: false,
    noMeals: true,
    currentPage: 1,
    totalPages: 1,
    pageText: "第 1 / 1 页",
    showPagination: false,
    prevDisabled: true,
    nextDisabled: true,
    status: "",
    addButtonText: "添加到今日餐食",
    addButtonClass: ""
  },

  onShow() {
    this.loadData();
  },

  onUnload() {
    if (this.addFeedbackTimer) clearTimeout(this.addFeedbackTimer);
  },

  loadData() {
    const currentFood = this.data.foods[this.data.selectedIndex];
    const foods = diet.sortFoodsByUsage(
      diet.readFoodCatalog(),
      diet.readDailyMealHistory()
    );
    const currentSignature = currentFood ? diet.foodSignature(currentFood) : "";
    const matchedIndex = foods.findIndex((food) => diet.foodSignature(food) === currentSignature);
    const selectedIndex = matchedIndex >= 0
      ? matchedIndex
      : Math.min(this.data.selectedIndex, Math.max(foods.length - 1, 0));
    const selectedFood = foods[selectedIndex];
    this.setData({
      foods,
      foodNames: foods.map((food) => food.name),
      selectedIndex,
      selectedFoodLabel: selectedFood ? selectedFood.name : "暂无食物，请先去饮食清单添加"
    });
    this.renderMealList(diet.readTodayMeals());
    this.renderSummary();
    this.renderServingPreview();
  },

  refreshFoodOrder(selectedFood) {
    const selectedSignature = selectedFood ? diet.foodSignature(selectedFood) : "";
    const foods = diet.sortFoodsByUsage(
      diet.readFoodCatalog(),
      diet.readDailyMealHistory()
    );
    const selectedIndex = Math.max(0, foods.findIndex((food) => diet.foodSignature(food) === selectedSignature));
    this.setData({
      foods,
      foodNames: foods.map((food) => food.name),
      selectedIndex,
      selectedFoodLabel: foods[selectedIndex] ? foods[selectedIndex].name : "暂无食物，请先去饮食清单添加"
    });
  },

  changeFood(event) {
    const selectedIndex = Number(event.detail.value || 0);
    const selectedFood = this.data.foods[selectedIndex];
    this.setData({
      selectedIndex,
      selectedFoodLabel: selectedFood ? selectedFood.name : "请选择食物",
      quantity: "",
      status: ""
    });
    this.renderServingPreview();
  },

  inputQuantity(event) {
    this.setData({ quantity: event.detail.value, status: "" });
    this.renderServingPreview();
  },

  renderServingPreview() {
    const food = this.data.foods[this.data.selectedIndex];
    if (!food || String(this.data.quantity).trim() === "") {
      this.setData({ servingPreview: "" });
      return;
    }
    const candidate = { ...food, quantity: Number(this.data.quantity || 0) };
    this.setData({
      servingPreview: `选择后记录为 ${diet.formatServingAmount(candidate)}，预计 ${diet.formatEnergy(diet.foodEnergy(candidate))}`
    });
  },

  renderSummary() {
    const intake = diet.totalIntake(diet.readTodayMeals());
    this.setData({
      summary: {
        kcal: diet.formatEnergy(intake.kcal),
        carbs: `${diet.round(intake.carbs)} g`,
        protein: `${diet.round(intake.protein)} g`,
        fat: `${diet.round(intake.fat)} g`
      }
    });
  },

  formatMeals(meals, highlightedId = "") {
    const unit = diet.readEnergyUnit();
    return meals.map((meal) => {
      const food = diet.mealFood(meal);
      const macros = diet.foodMacros(food);
      return {
        id: meal.id,
        initial: String(food.name || "?").slice(0, 1),
        name: food.name,
        serving: diet.formatServingAmount(food),
        servings: `${diet.formatDecimal(diet.foodPortions(food), 2).replace(/\.?0+$/, "")}份`,
        energy: diet.formatEnergy(diet.foodEnergy(food), unit),
        carbs: diet.formatDecimal(macros.carbs),
        protein: diet.formatDecimal(macros.protein),
        fat: diet.formatDecimal(macros.fat),
        consumedAtText: diet.formatDateTime(meal.consumedAt),
        hasConsumedAt: !!meal.consumedAt,
        rowClass: meal.id === highlightedId ? "is-new" : ""
      };
    });
  },

  renderMealList(meals, highlightedId = "", requestedPage = this.data.currentPage) {
    const totalPages = Math.max(1, Math.ceil(meals.length / MEAL_PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, requestedPage), totalPages);
    const pageStart = (currentPage - 1) * MEAL_PAGE_SIZE;
    const pageMeals = meals.slice(pageStart, pageStart + MEAL_PAGE_SIZE);
    this.setData({
      meals: this.formatMeals(pageMeals, highlightedId),
      hasMeals: meals.length > 0,
      noMeals: meals.length === 0,
      currentPage,
      totalPages,
      pageText: `第 ${currentPage} / ${totalPages} 页`,
      showPagination: meals.length > MEAL_PAGE_SIZE,
      prevDisabled: currentPage <= 1,
      nextDisabled: currentPage >= totalPages
    });
  },

  prevPage() {
    if (this.data.currentPage <= 1) return;
    this.renderMealList(diet.readTodayMeals(), "", this.data.currentPage - 1);
  },

  nextPage() {
    if (this.data.currentPage >= this.data.totalPages) return;
    this.renderMealList(diet.readTodayMeals(), "", this.data.currentPage + 1);
  },

  showAddSuccess(meal, food) {
    if (this.addFeedbackTimer) clearTimeout(this.addFeedbackTimer);
    if (wx.vibrateShort) {
      wx.vibrateShort({ type: "light" });
    }
    wx.showToast({
      title: `已添加 ${food.name}`,
      icon: "success",
      duration: 1200
    });
    this.setData({
      addButtonText: "已添加",
      addButtonClass: "is-success"
    });
    this.addFeedbackTimer = setTimeout(() => {
      this.setData({
        addButtonText: "添加到今日餐食",
        addButtonClass: "",
        meals: this.data.meals.map((item) => ({ ...item, rowClass: "" }))
      });
      this.addFeedbackTimer = null;
    }, 1200);
  },

  notifyHomeRefresh() {
    const app = getApp();
    if (app) {
      app.globalData = app.globalData || {};
      app.globalData.dietMealVersion = Date.now();
    }
    const pages = typeof getCurrentPages === "function" ? getCurrentPages() : [];
    const homePage = pages.find((page) => page.route === "pages/home/home" && typeof page.refreshFromMealChange === "function");
    if (homePage) homePage.refreshFromMealChange();
  },

  syncMeals() {
    cloudSync.queueSyncDietData({
      profile: diet.readProfile(),
      foods: diet.readFoodCatalog(),
      todayMeals: diet.readTodayMeals(),
      dailyMeals: diet.readDailyMealHistory(),
      dailySummaries: diet.buildDailySummaries(),
      energyUnit: diet.readEnergyUnit()
    });
  },

  addMeal() {
    const food = this.data.foods[this.data.selectedIndex];
    const quantity = Number(this.data.quantity || 0);
    if (!food) {
      this.setData({ status: "请先在饮食清单添加食物" });
      return;
    }
    if (quantity <= 0) {
      this.setData({ status: "数量需要大于 0" });
      return;
    }
    const meals = diet.readTodayMeals();
    const meal = diet.normalizeTodayMeal({
      id: `meal-${Date.now()}`,
      quantity,
      consumedAt: Date.now(),
      food: { ...food, quantity }
    });
    const nextMeals = [meal, ...meals].filter(Boolean);
    diet.saveTodayMeals(nextMeals);
    this.notifyHomeRefresh();
    this.syncMeals();
    this.setData({
      quantity: "",
      servingPreview: "",
      status: "已添加到今日餐食"
    });
    this.renderMealList(nextMeals, meal.id, 1);
    this.refreshFoodOrder(food);
    this.showAddSuccess(meal, food);
    this.renderSummary();
  },

  deleteMeal(event) {
    const id = event.currentTarget.dataset.id;
    const meals = diet.readTodayMeals().filter((meal) => meal.id !== id);
    diet.saveTodayMeals(meals);
    this.notifyHomeRefresh();
    this.syncMeals();
    this.setData({ status: "已删除" });
    this.renderMealList(meals);
    this.renderSummary();
  },

  clearMeals() {
    diet.saveTodayMeals([]);
    this.notifyHomeRefresh();
    this.syncMeals();
    this.setData({ status: "今日餐食已清空" });
    this.renderMealList([], "", 1);
    this.renderSummary();
  }
});
