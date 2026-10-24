const test = require("node:test");
const assert = require("node:assert/strict");
const diet = require("../miniprogram/utils/diet");

let pageDefinition;
global.Page = (definition) => { pageDefinition = definition; };
require("../miniprogram/pages/food-list/food-list");
delete global.Page;

test("editing decimal nutrition values keeps the input mounted between keystrokes", () => {
  const saved = [];
  global.wx = { setStorageSync: (_key, value) => saved.push(value) };
  let renders = 0;
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, unit: "kcal" },
    foodsStore: [diet.normalizeFood({ id: "test-food", name: "测试食物", carbs: 12, protein: 1, fat: 1 })],
    setData(update) { Object.assign(this.data, update); },
    renderFoods() { renders += 1; },
    syncFoodCatalog() {}
  };
  const edit = (value) => page.editFood({ currentTarget: { dataset: { id: "test-food", field: "carbs" } }, detail: { value } });

  edit("12");
  edit("12.");
  edit("12.5");

  assert.equal(renders, 0);
  assert.equal(page.foodsStore[0].carbs, 12.5);
  assert.equal(saved.at(-1)[0].carbs, 12.5);
  delete global.wx;
});

test("tapping outside or tapping the selected row again closes food editing", () => {
  let renders = 0;
  const page = {
    ...pageDefinition,
    data: { ...pageDefinition.data, selectedFoodId: "test-food" },
    setData(update) { Object.assign(this.data, update); },
    renderFoods() { renders += 1; }
  };

  page.stopEditTap();
  assert.equal(page.data.selectedFoodId, "test-food");
  page.closeEditOnOutside();
  assert.equal(page.data.selectedFoodId, "");
  assert.equal(renders, 1);
  page.closeEditOnOutside();
  assert.equal(renders, 1);
  page.selectFood({ currentTarget: { dataset: { id: "test-food" } } });
  assert.equal(page.data.selectedFoodId, "test-food");
  page.selectFood({ currentTarget: { dataset: { id: "test-food" } } });
  assert.equal(page.data.selectedFoodId, "");
});
