const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");
const PAGE_SIZE = 5;

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
    currentPage: 1,
    totalPages: 1,
    pageText: "第 1 / 1 页",
    showPagination: false,
    prevDisabled: true,
    nextDisabled: true,
    kcalActive: "active",
    kjActive: "",
    newFoodHasImage: false,
    newFoodNoImage: true,
    imageUploading: false,
    newFood: emptyFood(),
    status: ""
  },

  foodsStore: [],

  onShow() {
    this.loadFoods();
    this.refreshSharedFoods();
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

  refreshSharedFoods() {
    if (this.refreshingFoods) return;
    this.refreshingFoods = true;
    const dirty = !!wx.getStorageSync("dietFoodCatalogDirty");
    const pendingMutations = wx.getStorageSync("dietPendingFoodMutations");
    const uploadPending = dirty
      ? cloudSync.syncDietData({
        syncScope: "foods",
        foods: this.foodsStore,
        foodMutations: Array.isArray(pendingMutations) ? pendingMutations : []
      })
      : Promise.resolve({ localOnly: false });
    uploadPending.then((syncResult) => {
      if (syncResult.localOnly) {
        this.setData({ status: "食物库等待联网同步，当前显示本机数据" });
        return null;
      }
      return cloudSync.fetchDietData();
    }).then((cloudData) => {
      if (!cloudData) return null;
      const cloudFoods = cloudData && Array.isArray(cloudData.foods) ? cloudData.foods : [];
      if (cloudData && cloudData.hasFoodData && cloudFoods.length) {
        diet.saveFoodCatalog(cloudFoods);
        this.foodsStore = diet.readFoodCatalog();
        this.renderFoods();
        return;
      }
      if (!cloudData.localOnly && this.foodsStore.length) {
        return cloudSync.syncDietData({
          syncScope: "foods",
          foods: this.foodsStore
        });
      }
      if (cloudData.localOnly) {
        this.setData({ status: "云端食物库刷新失败，当前显示本机数据" });
      }
      return null;
    }).catch(() => {
      this.setData({ status: "云端食物库刷新失败，当前显示本机数据" });
    }).then(() => {
      this.refreshingFoods = false;
    });
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
    const filteredFoods = this.foodsStore
      .filter((food) => !keyword || String(food.name || "").toLowerCase().includes(keyword));
    const totalPages = Math.max(1, Math.ceil(filteredFoods.length / PAGE_SIZE));
    const currentPage = Math.min(Math.max(1, this.data.currentPage), totalPages);
    const pageStart = (currentPage - 1) * PAGE_SIZE;
    const foods = filteredFoods
      .slice(pageStart, pageStart + PAGE_SIZE)
      .map((food) => this.formatFood(food));
    this.setData({
      foods,
      hasFoods: foods.length > 0,
      noFoods: foods.length === 0,
      foodCountText: `${filteredFoods.length} 项`,
      currentPage,
      totalPages,
      pageText: `第 ${currentPage} / ${totalPages} 页`,
      showPagination: filteredFoods.length > PAGE_SIZE,
      prevDisabled: currentPage <= 1,
      nextDisabled: currentPage >= totalPages,
      kcalActive: this.data.unit === "kcal" ? "active" : "",
      kjActive: this.data.unit === "kJ" ? "active" : "",
      newFoodHasImage: !!this.data.newFood.image,
      newFoodNoImage: !this.data.newFood.image
    });
  },

  inputSearch(event) {
    this.setData({
      search: event.detail.value || "",
      currentPage: 1,
      selectedFoodId: ""
    });
    this.renderFoods();
  },

  prevPage() {
    if (this.data.currentPage <= 1) return;
    this.setData({
      currentPage: this.data.currentPage - 1,
      selectedFoodId: ""
    });
    this.renderFoods();
  },

  nextPage() {
    if (this.data.currentPage >= this.data.totalPages) return;
    this.setData({
      currentPage: this.data.currentPage + 1,
      selectedFoodId: ""
    });
    this.renderFoods();
  },

  changeUnit(event) {
    const unit = event.currentTarget.dataset.unit;
    wx.setStorageSync("dietEnergyUnit", unit);
    this.setData({ unit });
    this.renderFoods();
    cloudSync.queueSyncDietData({
      profile: diet.readProfile(),
      energyUnit: unit
    });
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
    let editedFood = null;
    const allFoods = this.foodsStore.map((food) => {
      if (food.id !== id) return food;
      const next = { ...food, [field]: numericFields.includes(field) ? Number(value || 0) : value };
      editedFood = diet.normalizeFood(next);
      return editedFood;
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
    this.syncFoodCatalog({ type: "upsert", food: editedFood });
    this.renderFoods();
  },

  deleteFood(event) {
    const id = event.currentTarget.dataset.id;
    const allFoods = this.foodsStore.filter((food) => food.id !== id);
    diet.saveFoodCatalog(allFoods);
    this.foodsStore = allFoods;
    this.setData({ selectedFoodId: "", status: "已删除" });
    this.syncFoodCatalog({ type: "delete", foodId: id });
    this.renderFoods();
  },

  openAddSheet() {
    this.imageUploadToken = "";
    this.setData({
      addVisible: true,
      newFood: emptyFood(),
      newFoodHasImage: false,
      newFoodNoImage: true,
      imageUploading: false,
      status: ""
    });
  },

  closeAddSheet() {
    this.imageUploadToken = "";
    this.setData({ addVisible: false, imageUploading: false });
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
        if (!file) return;
        if (!wx.cloud || !wx.cloud.uploadFile) {
          this.setData({ status: "云存储不可用，图片未添加" });
          return;
        }
        const extensionMatch = file.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
        const extension = extensionMatch ? extensionMatch[1].toLowerCase() : "jpg";
        const cloudPath = `diet-food-images/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${extension}`;
        const uploadToken = cloudPath;
        this.imageUploadToken = uploadToken;
        this.setData({
          newFood: { ...this.data.newFood, image: file },
          newFoodHasImage: true,
          newFoodNoImage: false,
          imageUploading: true,
          status: "图片上传中..."
        });
        wx.cloud.uploadFile({
          cloudPath,
          filePath: file
        }).then((uploadResult) => {
          if (this.imageUploadToken !== uploadToken) return;
          this.setData({
            newFood: { ...this.data.newFood, image: uploadResult.fileID },
            imageUploading: false,
            status: "图片已上传"
          });
        }).catch(() => {
          if (this.imageUploadToken !== uploadToken) return;
          this.setData({
            newFood: { ...this.data.newFood, image: "" },
            newFoodHasImage: false,
            newFoodNoImage: true,
            imageUploading: false,
            status: "图片上传失败，请重试"
          });
        });
      }
    });
  },

  addFood() {
    const data = this.data.newFood;
    if (this.data.imageUploading) {
      this.setData({ status: "请等待图片上传完成" });
      return;
    }
    if (!data.name.trim()) {
      this.setData({ status: "请填写食物名称" });
      return;
    }
    const unit = String(data.unit || "g").trim() || "g";
    const candidate = diet.normalizeFood({
      name: data.name.trim(),
      carbs: Number(data.carbs || 0),
      protein: Number(data.protein || 0),
      fat: Number(data.fat || 0),
      coefficient: Number(data.coefficient || 1),
      quantity: Number(data.quantity || (diet.isCountUnit(unit) ? 1 : 100)),
      unit,
      image: data.image || ""
    });
    if (this.foodsStore.some((food) => food.signature === candidate.signature)) {
      this.setData({ status: "不能添加完全重复的食物数据" });
      return;
    }
    const allFoods = [candidate, ...this.foodsStore];
    diet.saveFoodCatalog(allFoods);
    this.foodsStore = allFoods;
    this.imageUploadToken = "";
    this.setData({
      addVisible: false,
      newFood: emptyFood(),
      imageUploading: false,
      currentPage: 1,
      status: "已添加"
    });
    this.syncFoodCatalog({ type: "upsert", food: candidate });
    this.renderFoods();
  },

  syncFoodCatalog(foodMutation = null) {
    wx.setStorageSync("dietFoodCatalogDirty", true);
    const mutation = foodMutation ? {
      ...foodMutation,
      mutationId: `food-change-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    } : null;
    if (mutation) {
      const pending = wx.getStorageSync("dietPendingFoodMutations");
      const nextPending = [
        ...(Array.isArray(pending) ? pending : []),
        mutation
      ].slice(-100);
      wx.setStorageSync("dietPendingFoodMutations", nextPending);
    }
    cloudSync.queueSyncDietData({
      syncChannel: "foodCatalog",
      syncScope: "foods",
      profile: diet.readProfile(),
      foods: this.foodsStore,
      foodMutation: mutation
    });
  }
});
