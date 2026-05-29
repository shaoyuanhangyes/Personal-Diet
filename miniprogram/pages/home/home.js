const diet = require("../../utils/diet");

const RING_GRADIENTS = {
  total: ["#ffd1e8", "#ff86c8", "#ff4f9a", "#d80b2f"],
  carbs: ["#b9fbff", "#00d4ff", "#0077ff", "#0042d9"],
  protein: ["#ffd6ff", "#ff72f6", "#b36bff", "#6d5dfc"],
  fat: ["#ffd8a3", "#ffad5c", "#ff8a3d", "#9a5a2c"]
};

function ringProgressStyle(kind, percent) {
  const p = Math.max(0, Math.min(100, Number(percent) || 0));
  const colors = RING_GRADIENTS[kind];
  if (!p) {
    return "background:rgba(255,255,255,0.1);";
  }
  const s1 = Math.max(0.1, p * 0.28);
  const s2 = Math.max(s1 + 0.1, p * 0.62);
  return `background:conic-gradient(from -90deg, ${colors[0]} 0%, ${colors[1]} ${s1}%, ${colors[2]} ${s2}%, ${colors[3]} ${p}%, rgba(255,255,255,0.1) ${p}% 100%);`;
}

function makeRing(total, carbs, protein, fat, small = false) {
  const size = small ? "mini" : "large";
  const values = {
    total: Math.max(0, Math.min(100, Number(total) || 0)),
    carbs: Math.max(0, Math.min(100, Number(carbs) || 0)),
    protein: Math.max(0, Math.min(100, Number(protein) || 0)),
    fat: Math.max(0, Math.min(100, Number(fat) || 0))
  };
  return {
    totalClass: `ring-layer total ${size}`,
    carbsClass: `ring-layer carbs ${size}`,
    proteinClass: `ring-layer protein ${size}`,
    fatClass: `ring-layer fat ${size}`,
    totalValue: values.total,
    carbsValue: values.carbs,
    proteinValue: values.protein,
    fatValue: values.fat,
    totalStyle: ringProgressStyle("total", values.total),
    carbsStyle: ringProgressStyle("carbs", values.carbs),
    proteinStyle: ringProgressStyle("protein", values.protein),
    fatStyle: ringProgressStyle("fat", values.fat),
    totalText: `${diet.round(values.total)}%`,
    carbsText: `${diet.round(values.carbs)}%`,
    proteinText: `${diet.round(values.protein)}%`,
    fatText: `${diet.round(values.fat)}%`
  };
}

Page({
  data: {
    dayType: "training",
    trainingActive: "active",
    restActive: "",
    dayLabel: "力训日",
    unit: "kcal",
    targetCaloriesText: "0 kcal",
    balancedCaloriesText: "0 kcal",
    totalIntake: 0,
    percentText: "0%",
    remainingText: "0 kcal",
    ring: makeRing(0, 0, 0, 0),
    macros: [],
    homeMeals: [],
    hasHomeMeals: false,
    noHomeMeals: true,
    calendarVisible: false,
    calendarOpenClass: "",
    weekdays: ["一", "二", "三", "四", "五", "六", "日"],
    calendarMonthLabel: "",
    calendarDays: [],
    calendarSummary: {}
  },

  onReady() {
    this.queueHomeRingDraw();
  },

  onShow() {
    const dayType = wx.getStorageSync("dietDayType") || "training";
    diet.syncTodayMealsToHistory(diet.readTodayMeals());
    this.setData({ dayType }, () => {
      this.renderPage();
    });
  },

  onTabItemTap() {
    this.refreshFromMealChange();
  },

  onHide() {
    if (this.homeRingTimer) clearTimeout(this.homeRingTimer);
  },

  refreshFromMealChange() {
    diet.syncTodayMealsToHistory(diet.readTodayMeals());
    this.renderPage();
  },

  changeDay(event) {
    const dayType = event.currentTarget.dataset.day;
    wx.setStorageSync("dietDayType", dayType);
    this.setData({ dayType });
    this.renderPage();
  },

  goToday() {
    wx.switchTab({ url: "/pages/today-meals/today-meals" });
  },

  goSettings() {
    wx.switchTab({ url: "/pages/settings/settings" });
  },

  renderPage() {
    const dayType = this.data.dayType;
    const dayLabel = dayType === "training" ? "力训日" : "休息日";
    const unit = diet.readEnergyUnit();
    const targets = diet.calculateTargets(diet.readProfile());
    const meals = diet.readTodayMeals();
    const intake = diet.totalIntake(meals);
    const targetCalories = dayType === "training" ? targets.f1 : targets.f2;
    const balancedCalories = dayType === "training" ? targets.e1 : targets.e2;
    const macroTargets = diet.macroTargets(targetCalories);
    const totalPercent = diet.clampPercent(intake.kcal, targetCalories);
    const carbsPercent = diet.clampPercent(intake.carbs, macroTargets.carbs);
    const proteinPercent = diet.clampPercent(intake.protein, macroTargets.protein);
    const fatPercent = diet.clampPercent(intake.fat, macroTargets.fat);
    const homeMeals = meals.slice(0, 3).map((meal) => {
      const food = diet.mealFood(meal);
      const macros = diet.foodMacros(food);
      return {
        id: meal.id,
        initial: String(food.name || "?").slice(0, 1),
        name: food.name,
        serving: diet.formatServingAmount(food),
        carbs: diet.round(macros.carbs),
        protein: diet.round(macros.protein),
        fat: diet.round(macros.fat),
        energy: diet.formatEnergy(diet.foodEnergy(food), unit)
      };
    });

    const ring = makeRing(totalPercent, carbsPercent, proteinPercent, fatPercent);

    this.setData({
      dayLabel,
      trainingActive: dayType === "training" ? "active" : "",
      restActive: dayType === "rest" ? "active" : "",
      unit,
      targetCaloriesText: diet.formatEnergy(targetCalories, unit),
      balancedCaloriesText: diet.formatEnergy(balancedCalories, unit),
      totalIntake: diet.round(diet.energyValue(intake.kcal, unit)),
      percentText: `${diet.round(totalPercent)}%`,
      remainingText: diet.formatEnergy(Math.max(0, targetCalories - intake.kcal), unit),
      ring,
      macros: [
        this.buildMacro("carbs", "碳水化合物", intake.carbs, macroTargets.carbs),
        this.buildMacro("protein", "蛋白质", intake.protein, macroTargets.protein),
        this.buildMacro("fat", "脂肪", intake.fat, macroTargets.fat)
      ],
      homeMeals,
      hasHomeMeals: homeMeals.length > 0,
      noHomeMeals: homeMeals.length === 0
    }, () => {
      this.queueHomeRingDraw(ring);
    });

    if (this.data.calendarVisible) this.renderCalendar();
  },

  buildMacro(key, name, current, target) {
    const percent = diet.clampPercent(current, target);
    return {
      key,
      name,
      amount: `${diet.round(current)} / ${diet.round(target)} g`,
      percent,
      percentText: `${diet.round(percent)}%`,
      iconClass: `macro-icon ${key}`,
      glyphClass: `macro-glyph ${key}`,
      barClass: `bar-fill ${key}`,
      percentStyle: `width:${percent}%;`
    };
  },

  queueHomeRingDraw(ring = this.data.ring) {
    if (this.homeRingTimer) clearTimeout(this.homeRingTimer);
    const draw = () => {
      this.drawHomeRing(ring);
      this.homeRingTimer = setTimeout(() => {
        this.drawHomeRing(this.data.ring);
      }, 120);
    };
    if (wx.nextTick) {
      wx.nextTick(draw);
    } else {
      this.homeRingTimer = setTimeout(draw, 0);
    }
  },

  drawHomeRing(ring) {
    if (!ring || this.data.calendarVisible) return;
    const query = wx.createSelectorQuery().in(this);
    query.select("#home-ring-canvas").fields({ node: true, size: true }).exec((res) => {
      const canvasInfo = res && res[0];
      if (!canvasInfo || !canvasInfo.node || !canvasInfo.width || !canvasInfo.height) return;
      const canvas = canvasInfo.node;
      const ctx = canvas.getContext("2d");
      const dpr = wx.getWindowInfo ? wx.getWindowInfo().pixelRatio : wx.getSystemInfoSync().pixelRatio;
      const width = canvasInfo.width;
      const height = canvasInfo.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);

      const center = Math.min(width, height) / 2;
      if (center < 28) return;
      const start = -Math.PI / 2;
      const full = Math.PI * 2;
      const core = ctx.createRadialGradient(center * 0.92, center * 0.82, 12, center, center, center * 0.98);
      core.addColorStop(0, "#23315f");
      core.addColorStop(0.68, "#0e1630");
      core.addColorStop(1, "#070a14");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(center, center, center - 3, 0, full);
      ctx.fill();

      const strokeWidth = Math.max(6, center * 0.105);
      const rings = [
        { key: "total", value: ring.totalValue, radius: center * 0.86, width: strokeWidth },
        { key: "carbs", value: ring.carbsValue, radius: center * 0.68, width: strokeWidth },
        { key: "protein", value: ring.proteinValue, radius: center * 0.5, width: strokeWidth },
        { key: "fat", value: ring.fatValue, radius: center * 0.32, width: strokeWidth }
      ].filter((item) => item.radius > item.width / 2);

      rings.forEach((item) => {
        ctx.save();
        ctx.lineWidth = item.width;
        ctx.lineCap = "round";
        ctx.strokeStyle = "rgba(255,255,255,0.1)";
        ctx.beginPath();
        ctx.arc(center, center, item.radius, 0, full);
        ctx.stroke();

        const progress = Math.max(0, Math.min(1, item.value / 100));
        if (progress > 0) {
          const gradient = ctx.createLinearGradient(width, 0, 0, height);
          const colors = RING_GRADIENTS[item.key];
          gradient.addColorStop(0, colors[0]);
          gradient.addColorStop(0.34, colors[1]);
          gradient.addColorStop(0.68, colors[2]);
          gradient.addColorStop(1, colors[3]);
          ctx.shadowBlur = item.key === "total" ? 8 : 7;
          ctx.shadowColor = colors[1];
          ctx.strokeStyle = gradient;
          ctx.beginPath();
          ctx.arc(center, center, item.radius, start, start + full * Math.min(progress, 0.999), false);
          ctx.stroke();
        }
        ctx.restore();
      });

      const innerRadius = center * 0.39;
      const innerGlow = ctx.createRadialGradient(center, center, 2, center, center, innerRadius);
      innerGlow.addColorStop(0, "rgba(35, 49, 95, 0.98)");
      innerGlow.addColorStop(0.7, "rgba(14, 22, 48, 0.98)");
      innerGlow.addColorStop(1, "rgba(7, 10, 20, 0.98)");
      ctx.save();
      ctx.fillStyle = innerGlow;
      ctx.shadowBlur = 14;
      ctx.shadowColor = "rgba(0, 229, 255, 0.14)";
      ctx.beginPath();
      ctx.arc(center, center, innerRadius, 0, full);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.lineWidth = 1;
      ctx.strokeStyle = "rgba(255, 255, 255, 0.12)";
      ctx.stroke();

      const valueText = String(this.data.totalIntake || 0);
      const unitText = this.data.unit || "kcal";
      const valueFontSize = Math.max(18, Math.min(23, center * 0.28));
      const unitFontSize = Math.max(9, Math.min(11, center * 0.14));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#ffffff";
      ctx.font = `800 ${valueFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillText(valueText, center, center - unitFontSize * 0.45);
      ctx.fillStyle = "rgba(255, 255, 255, 0.66)";
      ctx.font = `600 ${unitFontSize}px -apple-system, BlinkMacSystemFont, sans-serif`;
      ctx.fillText(unitText, center, center + valueFontSize * 0.68);
      ctx.restore();
    });
  },

  openCalendar() {
    const now = new Date();
    this.calendarMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    this.selectedCalendarDate = diet.dateKey();
    this.setData({ calendarVisible: true, calendarOpenClass: "is-calendar-open" });
    this.renderCalendar();
  },

  closeCalendar() {
    this.setData({ calendarVisible: false, calendarOpenClass: "" }, () => {
      this.drawHomeRing(this.data.ring);
    });
  },

  prevMonth() {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() - 1, 1);
    this.selectedCalendarDate = diet.dateKey(this.calendarMonth);
    this.renderCalendar();
  },

  nextMonth() {
    this.calendarMonth = new Date(this.calendarMonth.getFullYear(), this.calendarMonth.getMonth() + 1, 1);
    this.selectedCalendarDate = diet.dateKey(this.calendarMonth);
    this.renderCalendar();
  },

  selectCalendarDay(event) {
    this.selectedCalendarDate = event.currentTarget.dataset.key;
    const selected = diet.parseDateKey(this.selectedCalendarDate);
    this.calendarMonth = new Date(selected.getFullYear(), selected.getMonth(), 1);
    this.renderCalendar();
  },

  mealsForDate(key) {
    if (key === diet.dateKey()) return diet.readTodayMeals();
    return diet.readDailyMealHistory()[key] || [];
  },

  dailySummary(key) {
    const meals = this.mealsForDate(key);
    const targets = diet.calculateTargets(diet.readProfile());
    const targetCalories = this.data.dayType === "training" ? targets.f1 : targets.f2;
    const macroTargets = diet.macroTargets(targetCalories);
    const intake = diet.totalIntake(meals);
    return {
      meals,
      intake,
      totalPercent: diet.clampPercent(intake.kcal, targetCalories),
      carbsPercent: diet.clampPercent(intake.carbs, macroTargets.carbs),
      proteinPercent: diet.clampPercent(intake.protein, macroTargets.protein),
      fatPercent: diet.clampPercent(intake.fat, macroTargets.fat)
    };
  },

  renderCalendar() {
    const month = this.calendarMonth || new Date();
    const firstDay = new Date(month.getFullYear(), month.getMonth(), 1);
    const gridStart = diet.addDays(firstDay, -((firstDay.getDay() + 6) % 7));
    const unit = diet.readEnergyUnit();
    const today = diet.dateKey();
    const calendarDays = Array.from({ length: 42 }, (_, index) => {
      const current = diet.addDays(gridStart, index);
      const key = diet.dateKey(current);
      const summary = this.dailySummary(key);
      return {
        key,
        day: current.getDate(),
        outside: current.getMonth() !== month.getMonth(),
        today: key === today,
        selected: key === this.selectedCalendarDate,
        hasData: summary.meals.length > 0,
        className: [
          "calendar-day",
          current.getMonth() !== month.getMonth() ? "is-outside" : "",
          key === today ? "is-today" : "",
          key === this.selectedCalendarDate ? "is-selected" : "",
          summary.meals.length > 0 ? "has-data" : ""
        ].filter(Boolean).join(" "),
        energy: summary.meals.length ? diet.round(diet.energyValue(summary.intake.kcal, unit)) : "0",
        ring: makeRing(summary.totalPercent, summary.carbsPercent, summary.proteinPercent, summary.fatPercent, true)
      };
    });
    const selectedSummary = this.dailySummary(this.selectedCalendarDate);
    const selectedDate = diet.parseDateKey(this.selectedCalendarDate);
    this.setData({
      calendarMonthLabel: `${month.getFullYear()}年${month.getMonth() + 1}月`,
      calendarDays,
      calendarSummary: {
        date: `${selectedDate.getMonth() + 1}月${selectedDate.getDate()}日`,
        energy: diet.formatEnergy(selectedSummary.intake.kcal, unit),
        percent: `${diet.round(selectedSummary.totalPercent)}%`,
        count: `${selectedSummary.meals.length}项`,
        carbs: `${diet.round(selectedSummary.intake.carbs)}g`,
        protein: `${diet.round(selectedSummary.intake.protein)}g`,
        fat: `${diet.round(selectedSummary.intake.fat)}g`
      }
    });
  }
});
