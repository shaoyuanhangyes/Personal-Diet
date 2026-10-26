const test = require("node:test");
const assert = require("node:assert/strict");
const diet = require("../miniprogram/utils/diet");

let pageDefinition;
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/today-meals/today-meals");
delete global.Page;

function createPage(foods) {
  return {
    ...pageDefinition,
    data: { ...pageDefinition.data, foods },
    setData(update) { Object.assign(this.data, update); }
  };
}

test("tile colors follow serving units rather than list position", () => {
  const foods = [
    { name: "鸡蛋", unit: "个" },
    { name: "牛奶", unit: "ml" },
    { name: "米饭", unit: "g" },
    { name: "燕麦包", unit: "g", packageGrams: 30 },
    { name: "果汁盒", unit: "ml", packageMl: 200 },
    { name: "香蕉", unit: "个" }
  ];
  const originalReadFoodCatalog = diet.readFoodCatalog;
  const originalReadDailyMealHistory = diet.readDailyMealHistory;
  const originalReadTodayMeals = diet.readTodayMeals;
  diet.readFoodCatalog = () => foods;
  diet.readDailyMealHistory = () => [];
  diet.readTodayMeals = () => [];
  try {
    const page = createPage([]);
    page.renderMealList = () => {};
    page.renderSummary = () => {};
    page.renderServingPreview = () => {};
    page.loadData();
    assert.deepEqual(page.data.foodTiles.map((tile) => tile.colorGroup), [
      "count", "measure", "measure", "package", "package", "count"
    ]);
    assert.deepEqual(page.data.foodTiles.map((tile) => tile.unitLabel), [
      "个数", "毫升数", "克数", "包装数", "包装数", "个数"
    ]);
  } finally {
    diet.readFoodCatalog = originalReadFoodCatalog;
    diet.readDailyMealHistory = originalReadDailyMealHistory;
    diet.readTodayMeals = originalReadTodayMeals;
  }
});

test("opening and closing without a highlighted tile keeps the selected food", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }, { name: "牛奶", unit: "ml" }]);
  page.data.selectedIndex = 1;
  page.toggleFoodPicker();
  assert.equal(page.data.foodPickerOpen, true);
  assert.equal(page.data.selectedIndex, 1);
  page.handleOutsideTap();
  assert.equal(page.data.foodPickerOpen, false);
  assert.equal(page.data.pendingFoodIndex, -1);
  assert.equal(page.data.selectedIndex, 1);
});

test("reopening the food picker anchors near the previously selected tile", () => {
  const foods = Array.from({ length: 32 }, (_, index) => ({ name: `食物${index}`, unit: "g" }));
  const page = createPage(foods);
  page.data.selectedIndex = 25;
  page.toggleFoodPicker();
  assert.equal(page.data.foodPickerAnchorId, "food-tile-20");
  page.selectFoodTile({ currentTarget: { dataset: { index: 30 } } });
  page.selectFoodTile({ currentTarget: { dataset: { index: 30 } } });
  assert.equal(page.data.foodPickerAnchorId, "");
  page.toggleFoodPicker();
  assert.equal(page.data.foodPickerAnchorId, "food-tile-24");
  assert.equal(page.data.selectedIndex, 30);
});

test("tapping the same highlighted tile twice confirms the food", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }, { name: "燕麦", unit: "g", packageGrams: 30 }]);
  page.data.quantity = "0.25";
  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.selectedIndex, 0);
  assert.equal(page.data.quantity, "0.25");
  assert.equal(page.data.foodPickerOpen, true);
  page.selectFoodTile({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.selectedIndex, 1);
  assert.equal(page.data.selectedFoodLabel, "燕麦");
  assert.equal(page.data.quantityUnitLabel, "包装数");
  assert.equal(page.data.quantity, "");
  assert.equal(page.data.foodPickerOpen, false);
  page.selectFoodTile({ currentTarget: { dataset: { index: 9 } } });
  assert.equal(page.data.selectedIndex, 1);
});

test("outside tap confirms the last highlighted tile, not an earlier one", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }, { name: "牛奶", unit: "ml" }, { name: "香蕉", unit: "个" }]);
  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 1 } } });
  page.selectFoodTile({ currentTarget: { dataset: { index: 2 } } });
  page.handleOutsideTap();
  assert.equal(page.data.selectedIndex, 2);
  assert.equal(page.data.selectedFoodLabel, "香蕉");
  assert.equal(page.data.foodPickerOpen, false);
});

test("tapping the picker trigger or leaving the page confirms a highlighted tile", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }, { name: "牛奶", unit: "ml" }]);
  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 1 } } });
  page.toggleFoodPicker();
  assert.equal(page.data.selectedIndex, 1);
  assert.equal(page.data.foodPickerOpen, false);

  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 0 } } });
  page.onHide();
  assert.equal(page.data.selectedIndex, 0);
  assert.equal(page.data.foodPickerOpen, false);
});

test("confirming the existing food keeps its entered quantity", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }]);
  page.data.quantity = "2";
  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 0 } } });
  page.handleOutsideTap();
  assert.equal(page.data.quantity, "2");
});

test("the meal add button only confirms the open picker and does not add a meal", () => {
  const page = createPage([{ name: "鸡蛋", unit: "个" }, { name: "牛奶", unit: "ml" }]);
  page.data.quantity = "1";
  page.toggleFoodPicker();
  page.selectFoodTile({ currentTarget: { dataset: { index: 1 } } });
  page.addMeal();
  assert.equal(page.data.selectedIndex, 1);
  assert.equal(page.data.quantity, "");
  assert.equal(page.data.foodPickerOpen, false);
});

test("meal IDs stay unique when two entries are added in one millisecond", () => {
  const page = createPage([{ id: "rice", name: "米饭", unit: "g", coefficient: 1, carbs: 20 }]);
  const originalRead = diet.readTodayMeals;
  const originalSave = diet.saveTodayMeals;
  const originalNow = Date.now;
  let meals = [];
  diet.readTodayMeals = () => meals;
  diet.saveTodayMeals = (next) => { meals = next; };
  Date.now = () => 123456789;
  page.notifyHomeRefresh = () => {};
  page.syncMeals = () => {};
  page.renderMealList = () => {};
  page.refreshFoodOrder = () => {};
  page.showAddSuccess = () => {};
  page.renderSummary = () => {};
  try {
    page.data.quantity = "1";
    page.addMeal();
    page.data.quantity = "2";
    page.addMeal();
    assert.equal(new Set(meals.map((meal) => meal.id)).size, 2);
    const deletedId = meals[0].id;
    page.deleteMeal({ currentTarget: { dataset: { id: deletedId } } });
    assert.deepEqual(meals.map((meal) => meal.quantity), [1]);
  } finally {
    diet.readTodayMeals = originalRead;
    diet.saveTodayMeals = originalSave;
    Date.now = originalNow;
  }
});
