# Personal Diet Mini Program

餐食记录微信小程序，包含首页目标跟踪、今日餐食、饮食清单和设置四个页面。

## 目录

- `miniprogram/`：小程序源码
- `cloudfunctions/login/`：微信登录云函数
- `cloudfunctions/getDietData/`：读取云端用户资料、食物数据库和餐食记录
- `cloudfunctions/syncDietData/`：用户资料、食物数据库和餐食记录同步云函数
- `cloudfunctions/recognizeNutrition/`：营养成分表 OCR 识别与每100g换算
- `project.config.json`：微信开发者工具项目配置

## 使用

1. 用微信开发者工具打开当前目录。
2. 开通云开发后，上传并部署 `login`、`getDietData`、`syncDietData` 和 `recognizeNutrition` 云函数（选择“云端安装依赖”）。如果使用 `miniprogram/` 作为项目根目录，则部署其中镜像的 `cloudfunctions/`。
3. 在小程序内使用微信登录后，会读取云端用户资料、食物数据库、今日餐食、历史餐食和摄入日历的每日营养汇总；本机独有的历史记录会合并回传到云数据库。
4. 云函数会自动确保 `diet_user_profiles`、`diet_food_catalogs`、`diet_daily_meals` 三个集合存在。

## 拍照识别营养表

在“饮食清单”中添加食物时，可以拍摄或上传营养成分表。云函数通过腾讯云 OCR 识别“每100g”或“每份”营养值；“每份”必须能识别出克数才能换算。识别结果填入表单，用户核对并填写食物名称后保存到共享食物库。上传的营养表图片仅用于识别，识别完成后会尝试删除；食物图片是另外的上传入口。

部署前需要在腾讯云控制台开通文字识别服务，并确认云函数运行角色具有调用 OCR 接口的权限。将 `recognizeNutrition` 的执行超时设置为至少 20 秒。OCR 调用可能产生费用。识别失败时仍可手动填写。
