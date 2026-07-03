import { api } from "./client";
import { USE_DUMMY_DATA } from "./config";
import { dummyCredentials, dummyUsers } from "./dummyData";

// Same function signature either way, so nothing calling this needs to
// change when USE_DUMMY_DATA flips to false.
export async function loginRequest(username, password) {
  if (USE_DUMMY_DATA) {
    return dummyLogin(username, password);
  }
  // Matches server/src/controllers/authController.js -> POST /api/auth/login
  // Returns { token, user }
  return api.post("/auth/login", { username, password }, { skipAuth: true });
}

function dummyLogin(username, password) {
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      const cred = dummyCredentials[username];
      if (!cred || cred.password !== password) {
        reject(new Error("Invalid username or password"));
        return;
      }
      const user = dummyUsers.find((u) => u.id === cred.userId);
      resolve({ token: `dummy-token-${user.id}`, user });
    }, 400);
  });
}
