const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");
const MEAL_PAGE_SIZE = 5;
const FOOD_TILES_PER_ROW = 4;
let mealIdSequence = 0;
const foodPickerAnchor = (index) => `food-tile-${Math.max(0, Math.floor(index / FOOD_TILES_PER_ROW) - 1) * FOOD_TILES_PER_ROW}`;
const quantityUnitLabel = (food) => {
  if (!food) return "克数";
  if (food.packageGrams > 1 || (!diet.isCountUnit(food.unit) && food.coefficient > 1)) return "包装数";
  if (food.packageMl > 1) return "包装数";
  if (food.unit === "ml") return "毫升数";
  return diet.isCountUnit(food.unit) ? "个数" : "克数";
};
const foodTiles = (foods) => foods.map((food, index) => {
  const unitLabel = quantityUnitLabel(food);
  return {
    index,
    name: food.name,
    initial: String(food.name || "?").slice(0, 1),
    unitLabel,
    colorGroup: unitLabel === "包装数" ? "package" : unitLabel === "个数" ? "count" : "measure"
  };
});

Page({
  data: {
    foods: [],
    foodTiles: [],
    foodPickerOpen: false,
    foodPickerAnchorId: "",
    pendingFoodIndex: -1,
    pendingFoodLabel: "",
    selectedIndex: 0,
    selectedFoodLabel: "请选择食物",
    quantityUnitLabel: "克数",
    quantity: "",
    servingPreview: "",
    summary: { kcal: "0 kcal", carbs: "0.0 g", protein: "0.0 g", fat: "0.0 g" },
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
    const viewEpoch = this.viewEpoch = (this.viewEpoch || 0) + 1;
    this.loadData();
    return cloudSync.refreshCalendarHistory().then((result) => {
      if (this.viewEpoch !== viewEpoch || result.localOnly) return;
      this.renderMealList(diet.readTodayMeals());
      this.renderSummary();
    });
  },

  onHide() {
    this.viewEpoch = (this.viewEpoch || 0) + 1;
    this.finishFoodPicker();
  },

  onUnload() {
    if (this.addFeedbackTimer) clearTimeout(this.addFeedbackTimer);
  },

  refreshFromCloud() {
    this.renderMealList(diet.readTodayMeals());
    this.renderSummary();
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
      foodTiles: foodTiles(foods),
      foodPickerOpen: false,
      foodPickerAnchorId: "",
      pendingFoodIndex: -1,
      pendingFoodLabel: "",
      selectedIndex,
      selectedFoodLabel: selectedFood ? selectedFood.name : "暂无食物，请先去饮食清单添加",
      quantityUnitLabel: quantityUnitLabel(selectedFood)
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
      foodTiles: foodTiles(foods),
      foodPickerOpen: false,
      foodPickerAnchorId: "",
      pendingFoodIndex: -1,
      pendingFoodLabel: "",
      selectedIndex,
      selectedFoodLabel: foods[selectedIndex] ? foods[selectedIndex].name : "暂无食物，请先去饮食清单添加",
      quantityUnitLabel: quantityUnitLabel(foods[selectedIndex])
    });
  },

  toggleFoodPicker() {
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
    this.setData({
      foodPickerOpen: true,
      foodPickerAnchorId: foodPickerAnchor(this.data.selectedIndex),
      pendingFoodIndex: -1,
      pendingFoodLabel: ""
    });
  },

  selectFoodTile(event) {
    const pendingFoodIndex = Number(event.currentTarget.dataset.index);
    if (!this.data.foodPickerOpen || !Number.isInteger(pendingFoodIndex) || pendingFoodIndex < 0 || pendingFoodIndex >= this.data.foods.length) return;
    if (pendingFoodIndex === this.data.pendingFoodIndex) {
      this.confirmFoodTile();
      return;
    }
    this.setData({
      pendingFoodIndex,
      pendingFoodLabel: this.data.foods[pendingFoodIndex].name,
      status: ""
    });
  },

  finishFoodPicker() {
    if (!this.data.foodPickerOpen) return;
    if (this.data.pendingFoodIndex >= 0) {
      this.confirmFoodTile();
      return;
    }
    this.setData({ foodPickerOpen: false, foodPickerAnchorId: "" });
  },

  handleOutsideTap() {
    this.finishFoodPicker();
  },

  confirmFoodTile() {
    const selectedIndex = this.data.pendingFoodIndex;
    if (!this.data.foodPickerOpen || !Number.isInteger(selectedIndex) || selectedIndex < 0 || selectedIndex >= this.data.foods.length) return;
    const selectedFood = this.data.foods[selectedIndex];
    const changed = selectedIndex !== this.data.selectedIndex;
    this.setData({
      selectedIndex,
      selectedFoodLabel: selectedFood.name,
      quantityUnitLabel: quantityUnitLabel(selectedFood),
      foodPickerOpen: false,
      foodPickerAnchorId: "",
      pendingFoodIndex: -1,
      pendingFoodLabel: "",
      quantity: changed ? "" : this.data.quantity,
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
        carbs: `${diet.formatDecimal(intake.carbs)} g`,
        protein: `${diet.formatDecimal(intake.protein)} g`,
        fat: `${diet.formatDecimal(intake.fat)} g`
      }
    });
  },

  formatMeals(meals, highlightedId = "") {
    const unit = diet.readEnergyUnit();
    return meals.map((meal) => {
      const food = diet.mealFood(meal);
      const intake = diet.mealIntake(meal);
      return {
        id: meal.id,
        initial: String(food.name || "?").slice(0, 1),
        name: food.name,
        serving: diet.formatServingAmount(food),
        energy: diet.formatEnergy(intake.kcal, unit),
        carbs: diet.formatDecimal(intake.carbs),
        protein: diet.formatDecimal(intake.protein),
        fat: diet.formatDecimal(intake.fat),
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
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
    if (this.data.currentPage <= 1) return;
    this.renderMealList(diet.readTodayMeals(), "", this.data.currentPage - 1);
  },

  nextPage() {
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
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
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
    const food = this.data.foods[this.data.selectedIndex];
    const quantity = Number(this.data.quantity || 0);
    if (!food) {
      this.setData({ status: "请先在饮食清单添加食物" });
      return;
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      this.setData({ status: "数量需要大于 0" });
      return;
    }
    const meals = diet.readTodayMeals();
    const meal = diet.normalizeTodayMeal({
      id: `meal-${Date.now()}-${++mealIdSequence}-${Math.random().toString(36).slice(2, 10)}`,
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
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
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
    if (this.data.foodPickerOpen) {
      this.finishFoodPicker();
      return;
    }
    diet.saveTodayMeals([]);
    this.notifyHomeRefresh();
    this.syncMeals();
    this.setData({ status: "今日餐食已清空" });
    this.renderMealList([], "", 1);
    this.renderSummary();
  }
});
