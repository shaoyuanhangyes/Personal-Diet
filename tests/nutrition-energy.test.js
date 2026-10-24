const test = require("node:test");
const assert = require("node:assert/strict");
const diet = require("../miniprogram/utils/diet");
const { parseNutrition } = require("../cloudfunctions/recognizeNutrition/parse");

test("label energy is used for gram-based food and survives normalization", () => {
  const food = diet.normalizeFood({ name: "样例", carbs: 10, protein: 2, fat: 1, energy: 80, quantity: 25, unit: "g" });
  assert.equal(food.energy, 80);
  assert.equal(diet.foodEnergy(food), 20);
  assert.equal(diet.foodMacros(food).carbs, 2.5);
});

test("old foods still derive energy from macros, and count units use per-item energy", () => {
  const oldFood = diet.normalizeFood({ name: "旧食物", carbs: 10, protein: 2, fat: 1, quantity: 100, unit: "g" });
  assert.equal(diet.foodEnergy(oldFood), 57);
  const countFood = diet.normalizeFood({ name: "鸡蛋", energy: 72, quantity: 2, unit: "个" });
  assert.equal(diet.foodEnergy(countFood), 144);
});

test("a 1g minimum unit records entered grams from the label basis", () => {
  const food = diet.normalizeLabeledFood({
    name: "燕麦", carbs: 15, protein: 3, fat: 2, energy: 90,
    coefficient: 1, quantity: 50
  });
  assert.equal(food.unit, "g");
  assert.equal(food.nutritionBasisGrams, 50);
  assert.equal(food.carbs, 30);
  assert.equal(diet.foodMacros({ ...food, quantity: 25 }).carbs, 7.5);
  assert.equal(diet.foodEnergy({ ...food, quantity: 25 }), 45);
  assert.equal(diet.formatServingAmount({ ...food, quantity: 25 }), "25g");
});

test("a package above 1g records entered package count", () => {
  const food = diet.normalizeLabeledFood({
    name: "酸奶", carbs: 10, protein: 4, fat: 3, energy: 80,
    coefficient: 200, quantity: 100
  });
  assert.equal(food.unit, "个");
  assert.equal(food.packageGrams, 200);
  assert.equal(food.carbs, 20);
  assert.equal(diet.foodMacros({ ...food, quantity: 0.25 }).carbs, 5);
  assert.equal(diet.foodEnergy({ ...food, quantity: 0.25 }), 40);
  assert.equal(diet.formatServingAmount({ ...food, quantity: 0.25 }), "0.25个包装");
  assert.equal(diet.foodReferenceEnergyLabel(food), "每包装");
});

test("a milliliter drink uses volume without assuming density", () => {
  const food = diet.normalizeLabeledFood({
    name: "饮料", carbs: 11, protein: 1, fat: 0, energy: 210,
    coefficient: 1, quantity: 100, measureUnit: "ml", energyUnit: "kJ"
  });
  assert.equal(food.unit, "ml");
  assert.equal(food.nutritionBasisMl, 100);
  assert.equal(diet.foodReferenceEnergyLabel(food), "每100ml");
  assert.equal(diet.foodMacros({ ...food, quantity: 250 }).carbs, 27.5);
  assert.equal(diet.formatServingAmount({ ...food, quantity: 250 }), "250ml");
  assert.ok(Math.abs(diet.foodEnergy({ ...food, quantity: 250 }) - 125.478) < 0.001);
});

test("a bottled drink records bottle count and converts kJ to stored kcal", () => {
  const food = diet.normalizeLabeledFood({
    name: "瓶装饮料", carbs: 8, protein: 1, fat: 0, energy: 200,
    coefficient: 250, quantity: 100, measureUnit: "ml", energyUnit: "kJ"
  });
  assert.equal(food.unit, "个");
  assert.equal(food.packageMl, 250);
  assert.equal(diet.foodMacros({ ...food, quantity: 0.5 }).carbs, 10);
  assert.equal(diet.formatServingAmount({ ...food, quantity: 0.5 }), "0.5个包装");
  assert.ok(Math.abs(diet.foodEnergy({ ...food, quantity: 0.5 }) - 59.7514) < 0.001);
});

test("a scanned 30g serving stays the nutrition basis after saving", () => {
  const scan = parseNutrition([
    "营养成分表", "每份食用量:30克", "项目 每份",
    "能量 678千焦", "蛋白质 1.1克", "脂肪 10.1克", "碳水化合物 16.8克"
  ]);
  assert.equal(scan.ok, true);
  const food = diet.normalizeLabeledFood({ ...scan.food, name: "薯片", coefficient: 1 });
  assert.equal(food.nutritionBasisGrams, 30);
  assert.equal(food.unit, "g");
  assert.ok(Math.abs(food.carbs - 56) < 1e-9);
  assert.ok(Math.abs(diet.foodMacros({ ...food, quantity: 15 }).carbs - 8.4) < 1e-9);
});
