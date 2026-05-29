const diet = require("../../utils/diet");

Page({
  data: {
    foods: [],
    foodNames: [],
    selectedIndex: 0,
    selectedFoodLabel: "请选择食物",
    quantity: 100,
    servingPreview: "",
    summary: { kcal: "0 kcal", carbs: "0 g", protein: "0 g", fat: "0 g" },
    meals: [],
    hasMeals: false,
    noMeals: true,
    status: ""
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const foods = diet.readFoodCatalog();
    const selectedIndex = Math.min(this.data.selectedIndex, Math.max(foods.length - 1, 0));
    const selectedFood = foods[selectedIndex];
    const formattedMeals = this.formatMeals(diet.readTodayMeals());
    this.setData({
      foods,
      foodNames: foods.map((food) => food.name),
      selectedIndex,
      selectedFoodLabel: selectedFood ? selectedFood.name : "暂无食物，请先去饮食清单添加",
      meals: formattedMeals,
      hasMeals: formattedMeals.length > 0,
      noMeals: formattedMeals.length === 0
    });
    this.renderSummary();
    this.renderServingPreview();
  },

  changeFood(event) {
    const selectedIndex = Number(event.detail.value || 0);
    const selectedFood = this.data.foods[selectedIndex];
    this.setData({
      selectedIndex,
      selectedFoodLabel: selectedFood ? selectedFood.name : "请选择食物",
      quantity: selectedFood ? selectedFood.quantity : 100,
      status: ""
    });
    this.renderServingPreview();
  },

  inputQuantity(event) {
    this.setData({ quantity: Number(event.detail.value || 0), status: "" });
    this.renderServingPreview();
  },

  renderServingPreview() {
    const food = this.data.foods[this.data.selectedIndex];
    if (!food) {
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

  formatMeals(meals) {
    const unit = diet.readEnergyUnit();
    return meals.map((meal) => {
      const food = diet.mealFood(meal);
      const macros = diet.foodMacros(food);
      return {
        id: meal.id,
        initial: String(food.name || "?").slice(0, 1),
        name: food.name,
        serving: diet.formatServingAmount(food),
        energy: diet.formatEnergy(diet.foodEnergy(food), unit),
        carbs: diet.round(macros.carbs),
        protein: diet.round(macros.protein),
        fat: diet.round(macros.fat)
      };
    });
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
      food: { ...food, quantity }
    });
    const nextMeals = [meal, ...meals].filter(Boolean);
    const formattedMeals = this.formatMeals(nextMeals);
    diet.saveTodayMeals(nextMeals);
    this.notifyHomeRefresh();
    this.setData({
      meals: formattedMeals,
      hasMeals: formattedMeals.length > 0,
      noMeals: formattedMeals.length === 0,
      status: "已添加到今日餐食"
    });
    this.renderSummary();
    this.renderServingPreview();
  },

  deleteMeal(event) {
    const id = event.currentTarget.dataset.id;
    const meals = diet.readTodayMeals().filter((meal) => meal.id !== id);
    const formattedMeals = this.formatMeals(meals);
    diet.saveTodayMeals(meals);
    this.notifyHomeRefresh();
    this.setData({
      meals: formattedMeals,
      hasMeals: formattedMeals.length > 0,
      noMeals: formattedMeals.length === 0,
      status: "已删除"
    });
    this.renderSummary();
  },

  clearMeals() {
    diet.saveTodayMeals([]);
    this.notifyHomeRefresh();
    this.setData({ meals: [], hasMeals: false, noMeals: true, status: "今日餐食已清空" });
    this.renderSummary();
  }
});
