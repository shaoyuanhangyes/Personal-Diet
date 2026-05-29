const USER_STORAGE_KEY = "dietUser";

let syncTimer = null;

function getCloudReady() {
  let app = null;
  try {
    app = getApp();
  } catch (error) {
    app = null;
  }
  return !!(wx.cloud && app && app.globalData && app.globalData.cloudReady);
}

function getStoredUser() {
  try {
    return wx.getStorageSync(USER_STORAGE_KEY) || null;
  } catch (error) {
    return null;
  }
}

function saveStoredUser(user) {
  wx.setStorageSync(USER_STORAGE_KEY, user);
}

function clearStoredUser() {
  wx.removeStorageSync(USER_STORAGE_KEY);
}

function wechatLogin() {
  return new Promise((resolve, reject) => {
    wx.login({
      success(result) {
        if (result.code) {
          resolve(result.code);
          return;
        }
        reject(new Error("微信登录未返回 code"));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

function callCloudFunction(name, data = {}) {
  if (!getCloudReady()) {
    return Promise.reject(new Error("未启用微信云开发"));
  }
  return wx.cloud.callFunction({ name, data });
}

function resolveOpenId() {
  return callCloudFunction("login").then((result) => {
    const data = result && result.result ? result.result : {};
    return data.openid || data.OPENID || "";
  });
}

function loginWithWechat(payload = {}) {
  return wechatLogin()
    .then(() => resolveOpenId()
      .catch(() => "")
      .then((openid) => {
        const user = {
          name: "微信用户",
          phone: openid ? `OpenID ${openid.slice(-6)}` : "已调用微信登录",
          openid,
          hasWechatSession: true,
          loginAt: Date.now()
        };
        saveStoredUser(user);
        return syncDietData(payload).then((syncResult) => ({ user, syncResult }));
      }));
}

function syncDietData(payload = {}) {
  const user = getStoredUser();
  const data = {
    openid: user && user.openid ? user.openid : "",
    profile: payload.profile || {},
    foods: Array.isArray(payload.foods) ? payload.foods : [],
    updatedAt: Date.now()
  };
  wx.setStorageSync("dietLastSyncPayload", data);
  if (!user) {
    return Promise.resolve({ localOnly: true, message: "未登录，已保存在本机" });
  }
  return callCloudFunction("syncDietData", data)
    .then(() => ({ localOnly: false, message: "已同步到后台" }))
    .catch((error) => ({
      localOnly: true,
      message: error && error.message ? "云同步未配置，已保存在本机" : "已保存在本机"
    }));
}

function queueSyncDietData(payload = {}, delay = 700) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    syncDietData(payload).catch(() => {});
  }, delay);
}

module.exports = {
  clearStoredUser,
  getStoredUser,
  loginWithWechat,
  queueSyncDietData,
  syncDietData
};
