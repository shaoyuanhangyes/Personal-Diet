const diet = require("../../utils/diet");
const cloudSync = require("../../utils/cloud-sync");
const PAGE_SIZE = 5;
const energyInputValue = (kcal, unit) => Number(diet.energyValue(kcal, unit).toFixed(4));

const emptyFood = () => ({
  name: "",
  carbs: "",
  protein: "",
  fat: "",
  energy: "",
  coefficient: "",
  quantity: "",
  measureUnit: "g"
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
    newFood: emptyFood(),
    ocrLoading: false,
    ocrReview: false,
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
    const measureUnit = diet.foodMeasureUnit(food);
    const packageSize = diet.foodPackageSize(food);
    const nutritionBasis = diet.foodNutritionBasis(food);
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
      energyValue: food.energy == null ? "" : energyInputValue(food.energy, this.data.unit),
      carbsValue: food.carbs,
      proteinValue: food.protein,
      fatValue: food.fat,
      coefficientValue: packageSize || food.coefficient,
      quantityValue: nutritionBasis || food.quantity,
      unitValue: food.unit,
      spec: packageSize ? `${packageSize}${measureUnit}` : food.servingSize ? `每份${food.servingSize}${measureUnit}` : diet.formatUnitGrams(food),
      quantityText: nutritionBasis ? `营养标示 每${nutritionBasis}${measureUnit}` : `默认 ${food.quantity}${food.unit}`,
      hasNutritionBasis: !!nutritionBasis,
      measureUnit,
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
      kjActive: this.data.unit === "kJ" ? "active" : ""
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
    if (unit === this.data.unit) return;
    const currentEnergy = this.data.newFood.energy;
    if (currentEnergy !== "" && currentEnergy !== null && currentEnergy !== undefined && !Number.isFinite(Number(currentEnergy))) {
      this.setData({ status: "请先填写完整的能量数值再切换单位" });
      return;
    }
    const newFoodEnergy = currentEnergy === "" || currentEnergy === null || currentEnergy === undefined
      ? currentEnergy : energyInputValue(diet.energyToKcal(currentEnergy, this.data.unit), unit);
    wx.setStorageSync("dietEnergyUnit", unit);
    this.setData({ unit, "newFood.energy": newFoodEnergy });
    this.renderFoods();
    cloudSync.queueSyncDietData({
      profile: diet.readProfile(),
      energyUnit: unit
    });
  },

  selectFood(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selectedFoodId: this.data.selectedFoodId === id ? "" : id });
    this.renderFoods();
  },

  closeEditOnOutside() {
    if (!this.data.selectedFoodId) return;
    this.setData({ selectedFoodId: "" });
    this.renderFoods();
  },

  toggleEdit(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ selectedFoodId: this.data.selectedFoodId === id ? "" : id });
    this.renderFoods();
  },

  stopEditTap() {},

  editFood(event) {
    const id = event.currentTarget.dataset.id;
    const field = event.currentTarget.dataset.field;
    const value = event.detail.value;
    if (field === "energy" && value !== "" && (!Number.isFinite(Number(value)) || Number(value) < 0)) {
      this.setData({ status: "能量需为非负数字" });
      return;
    }
    const numericFields = ["carbs", "protein", "fat", "coefficient", "quantity"];
    if (numericFields.includes(field) && value !== "" && !Number.isFinite(Number(value))) {
      this.setData({ status: "请输入有效数字" });
      return;
    }
    if (field === "coefficient" && this.foodsStore.some((food) => food.id === id && diet.foodNutritionBasis(food))) {
      const grams = Number(value);
      if (!Number.isFinite(grams) || grams < 1) {
        this.setData({ status: "最小包装规格需至少为 1" });
        return;
      }
    }
    if (field === "quantity" && this.foodsStore.some((food) => food.id === id && diet.foodNutritionBasis(food))) {
      const grams = Number(value);
      if (!Number.isFinite(grams) || grams <= 0) {
        this.setData({ status: "营养标示基准需大于 0" });
        return;
      }
    }
    let editedFood = null;
    const allFoods = this.foodsStore.map((food) => {
      if (food.id !== id) return food;
      const measureUnit = diet.foodMeasureUnit(food);
      let next = { ...food, [field]: field === "energy" ? (value === "" ? null : diet.energyToKcal(value, this.data.unit)) : numericFields.includes(field) ? Number(value || 0) : value };
      if (diet.foodNutritionBasis(food) && field === "quantity") {
        next = { ...food, [measureUnit === "ml" ? "nutritionBasisMl" : "nutritionBasisGrams"]: Number(value || 0) };
      }
      if (diet.foodNutritionBasis(food) && field === "coefficient") {
        const previousBase = diet.foodPackageSize(food) > 1 ? diet.foodPackageSize(food) : 100;
        const nextBase = Number(value) > 1 ? Number(value) : 100;
        const factor = nextBase / previousBase;
        next = {
          ...food,
          carbs: food.carbs * factor,
          protein: food.protein * factor,
          fat: food.fat * factor,
          energy: food.energy === null ? null : food.energy * factor,
          [measureUnit === "ml" ? "packageMl" : "packageGrams"]: Number(value),
          coefficient: Number(value),
          quantity: Number(value) > 1 ? 1 : 100,
          unit: Number(value) > 1 ? "个" : measureUnit
        };
      }
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
    this.nutritionScanToken = "";
    this.setData({
      addVisible: true,
      newFood: emptyFood(),
      ocrLoading: false,
      ocrReview: false,
      status: ""
    });
  },

  closeAddSheet() {
    this.nutritionScanToken = "";
    this.setData({ addVisible: false });
  },

  stopSheetTap() {},

  inputNewFood(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({
      [`newFood.${field}`]: event.detail.value,
      status: ""
    });
  },

  chooseNutritionPhoto(event) {
    if (this.data.ocrLoading) return;
    const source = event.currentTarget.dataset.source;
    wx.chooseMedia({
      count: 1,
      mediaType: ["image"],
      sizeType: ["original"],
      sourceType: [source],
      success: (result) => {
        const photo = result.tempFiles && result.tempFiles[0];
        if (!photo || !photo.tempFilePath) return;
        if (photo.size > 7 * 1024 * 1024) {
          this.setData({ status: "图片超过 7MB，请重新拍摄或选择较小的图片" });
          return;
        }
        if (!wx.cloud || !wx.cloud.uploadFile || !wx.cloud.callFunction) {
          this.setData({ status: "云开发不可用，暂时无法识别营养成分表" });
          return;
        }

        const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        this.nutritionScanToken = token;
        this.setData({ ocrLoading: true, ocrReview: false, status: "正在识别营养成分表..." });
        const extension = (photo.tempFilePath.match(/\.(jpg|jpeg|png|bmp)(?:\?|$)/i) || [])[1] || "jpg";
        let fileID = "";
        wx.cloud.uploadFile({
          cloudPath: `diet-nutrition-labels/${token}.${extension.toLowerCase()}`,
          filePath: photo.tempFilePath
        }).then((upload) => {
          fileID = upload.fileID;
          return wx.cloud.callFunction({ name: "recognizeNutrition", data: { fileID } });
        }).then((response) => {
          if (this.nutritionScanToken !== token) return;
          const result = response && response.result;
          if (!result || !result.ok) {
            if (result && result.errorCode) console.error("nutrition OCR error code:", result.errorCode);
            throw new Error(result && result.message || "识别失败");
          }
          this.setData({
            newFood: {
              ...this.data.newFood,
              ...result.food,
              energy: result.labelEnergy && result.labelEnergy.unit === this.data.unit
                ? result.labelEnergy.value : energyInputValue(result.food.energy, this.data.unit),
              coefficient: "",
              quantity: result.food.quantity,
              measureUnit: result.food.measureUnit || "g"
            },
            ocrReview: true,
            status: result.message || "已识别，请核对食物名称和营养数值后保存"
          });
        }).catch((error) => {
          if (this.nutritionScanToken !== token) return;
          this.setData({ status: error && (error.message || error.errMsg) || "识别失败，请重试" });
        }).then(() => {
          if (fileID && wx.cloud.deleteFile) wx.cloud.deleteFile({ fileList: [fileID] }).catch(() => {});
          if (this.nutritionScanToken === token) this.setData({ ocrLoading: false });
        });
      }
    });
  },

  addFood() {
    const data = this.data.newFood;
    if (this.data.ocrLoading) {
      this.setData({ status: "请等待识别完成" });
      return;
    }
    if (!data.name.trim()) {
      this.setData({ status: "请填写食物名称" });
      return;
    }
    const numbers = [data.carbs, data.protein, data.fat, data.energy, data.coefficient, data.quantity]
      .filter((value) => value !== "" && value !== undefined && value !== null);
    if (numbers.some((value) => !Number.isFinite(Number(value)) || Number(value) < 0)) {
      this.setData({ status: "营养数值、规格和数量需为非负数字" });
      return;
    }
    if (data.coefficient !== "" && Number(data.coefficient) < 1) {
      this.setData({ status: "最小包装规格需至少为 1" });
      return;
    }
    if (data.quantity !== "" && Number(data.quantity) <= 0) {
      this.setData({ status: "营养标示基准需大于 0" });
      return;
    }
    const candidate = diet.normalizeLabeledFood({ ...data, name: data.name.trim(), energyUnit: this.data.unit });
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
      ocrReview: false,
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
