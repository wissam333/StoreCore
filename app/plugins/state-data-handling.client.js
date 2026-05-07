export default defineNuxtPlugin((nuxtApp) => {
  if (process.client) {
    const token = localStorage.getItem("token"); // ✅
    const startActivity = localStorage.getItem("startActivity");

    // Session timeout check
    if (startActivity) {
      const threeHours = 3600 * 3 * 1000;
      if (Date.now() - parseInt(startActivity) > threeHours) {
        localStorage.clear();
        localStorage.setItem("startActivity", Date.now().toString());
        useToken().value = null;
        useMainToken().value = null;
        useUserInfo().value = null;
        return;
      }
    }

    const userInfoRaw = localStorage.getItem("userInfo");
    const role = localStorage.getItem("role");
    const userInfo =
      userInfoRaw && userInfoRaw !== "undefined"
        ? JSON.parse(userInfoRaw)
        : null;

    if (token && userInfo && role) {
      useToken().value = token;
      useMainToken().value = token;
      useUserInfo().value = userInfo;
      useRole().value = role;
    } else {
      useToken().value = null;
      useMainToken().value = null;
      useUserInfo().value = null;
      localStorage.removeItem("userInfo");
      localStorage.removeItem("role");
      localStorage.removeItem("token");
    }
  }
});
