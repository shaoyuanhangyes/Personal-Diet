const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");

const emptyFood = () => ({
  name: "",
  carbs: "",
  protein: "",
  fat: "",
  coefficient: "",
  quantity: "",
  unit: "",
  image: ""
});

Page({
  data: {
    foods: [],
    unit: "kcal",
    search: "",
    selectedFoodId: "",
    addVisible: false,
    hasFoods: false,
    noFoods: true,
    foodCountText: "0 项",
    kcalActive: "active",
    kjActive: "",
    newFoodHasImage: false,
    newFoodNoImage: true,
    newFood: emptyFood(),
    status: ""
  },

  foodsStore: [],

  onShow() {
    this.loadFoods();
  },

  loadFoods() {
    try {
      this.foodsStore = diet.readFoodCatalog();
      this.setData({
        unit: diet.readEnergyUnit(),
        status: ""
      });
      this.renderFoods();
    } catch (error) {
      this.foodsStore = [];
      this.setData({
        foods: [],
        hasFoods: false,
        noFoods: true,
        foodCountText: "0 项",
        status: "食物数据读取失败，请重新添加"
      });
    }
  },

  formatFood(food) {
    return {
      id: food.id,
      name: food.name,
      unit: food.unit,
      quantity: food.quantity,
      initial: String(food.name || "?").slice(0, 1),
      rowClass: `food-row ${food.id === this.data.selectedFoodId ? "is-selected" : ""}`,
      hasImage: !!food.image,
      noImage: !food.image,
      image: food.image || "",
      carbsText: Number(food.carbs).toFixed(1),
      proteinText: Number(food.protein).toFixed(1),
      fatText: Number(food.fat).toFixed(1),
      carbsValue: food.carbs,
      proteinValue: food.protein,
      fatValue: food.fat,
      coefficientValue: food.coefficient,
      quantityValue: food.quantity,
      unitValue: food.unit,
      spec: diet.formatUnitGrams(food),
      energy: `${diet.foodReferenceEnergyLabel(food)} ${diet.formatEnergy(diet.foodEnergyPer100g(food), this.data.unit)}`,
      editing: food.id === this.data.selectedFoodId,
      readonly: food.id !== this.data.selectedFoodId,
      editIconClass: food.id === this.data.selectedFoodId ? "edit-icon is-done" : "edit-icon"
    };
  },

  renderFoods() {
    const keyword = this.data.search.trim().toLowerCase();
    const foods = this.foodsStore
      .filter((food) => !keyword || String(food.name || "").toLowerCase().includes(keyword))
      .map((food) => this.formatFood(food));
    this.setData({
      foods,
      hasFoods: foods.length > 0,
      noFoods: foods.length === 0,
      foodCountText: `${foods.length} 项`,
      kcalActive: this.data.unit === "kcal" ? "active" : "",
      kjActive: this.data.unit === "kJ" ? "active" : "",
      newFoodHasImage: !!this.data.newFood.image,
      newFoodNoImage: !this.data.newFood.image
    });
  },

  inputSearch(event) {
    this.setData({ search: event.detail.value || "" });
    this.renderFoods();
  },

  changeUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    wx.setStorageSync("dietEnergyUnit", unit);
    this.setData({ unit });
    this.renderFoods();
    this.syncFoodCatalog();
  },

  selectFood(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selectedFoodId: id });
    this.renderFoods();
  },

  toggleEdit(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selectedFoodId: this.data.selectedFoodId === id ? "" : id });
    this.renderFoods();
  },

  editFood(event) {
    const id = event.currentTarget.dataset.id;
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    const numericFields = ["carbs", "protein", "fat", "coefficient", "quantity"];
    const allFoods = this.foodsStore.map((food) => {
      if (food.id !== id) return food;
      const next = { ...food, [field]: numericFields.includes(field) ? Number(value || 0) : value };
      return diet.normalizeFood(next);
    });
    const edited = allFoods.find((food) => food.id === id);
    const duplicate = allFoods.some((food) => food.id !== id && food.signature === edited.signature);
    if (duplicate) {
      this.setData({ status: "不能保存完全重复的食物数据" });
      return;
    }
    diet.saveFoodCatalog(allFoods);
    this.foodsStore = allFoods;
    this.setData({ status: "已更新" });
    this.syncFoodCatalog();
    this.renderFoods();
  },

  deleteFood(event) {
    const id = event.currentTarget.dataset.id;
    const allFoods = this.foodsStore.filter((food) => food.id !== id);
    diet.saveFoodCatalog(allFoods);
    this.foodsStore = allFoods;
    this.setData({ selectedFoodId: "", status: "已删除" });
    this.syncFoodCatalog();
    this.renderFoods();
  },

  openAddSheet() {
    this.setData({
      addVisible: true,
      newFood: emptyFood(),
      newFoodHasImage: false,
      newFoodNoImage: true,
      status: ""
    });
  },

  closeAddSheet() {
    this.setData({ addVisible: false });
  },

  inputNewFood(event) {
    const field = event.currentTarget.dataset.field;
    const newFood = { ...this.data.newFood, [field]: event.detail.value };
    this.setData({
      newFood,
      newFoodHasImage: !!newFood.image,
      newFoodNoImage: !newFood.image,
      status: ""
    });
  },

  chooseImage() {
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sourceType: ["album", "camera"],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0] && result.tempFiles[0].tempFilePath;
        if (file) {
          this.setData({
            newFood: { ...this.data.newFood, image: file },
            newFoodHasImage: true,
            newFoodNoImage: false
          });
        }
      }
    });
  },

  addFood() {
    const data = this.data.newFood;
    if (!data.name.trim()) {
      this.setData({ status: "请填写食物名称" });
      return;
    }
    const candidate = diet.normalizeFood({
      name: data.name.trim(),
      carbs: Number(data.carbs || 0),
      protein: Number(data.protein || 0),
      fat: Number(data.fat || 0),
      coefficient: Number(data.coefficient || 1),
      quantity: Number(data.quantity || 100),
      unit: data.unit || "g",
      image: data.image || ""
    });
    if (this.foodsStore.some((food) => food.signature === candidate.signature)) {
      this.setData({ status: "不能添加完全重复的食物数据" });
      return;
    }
    const allFoods = [candidate, ...this.foodsStore];
    diet.saveFoodCatalog(allFoods);
    this.foodsStore = allFoods;
    this.setData({
      addVisible: false,
      newFood: emptyFood(),
      status: "已添加"
    });
    this.syncFoodCatalog();
    this.renderFoods();
  },

  syncFoodCatalog() {
    cloudSync.queueSyncDietData({
      profile: diet.readProfile(),
      foods: this.foodsStore
    });
  }
});
