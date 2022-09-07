// @ts-check

const cp = require("child_process");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const { setTimeout: sleep } = require("timers/promises");
const exec = promisify(cp.exec);
const spawn = promisify(cp.spawn);

async function findMainPID() {
  if (os.platform() === "win32") {
    return await exec("wmic process where name='rustdesk.exe' get processid", {
      windowsHide: true,
    })
      .then(({ stdout }) => {
        const pid = stdout.split("\n")[1].trim();
        if (pid) {
          console.log("found main process with pid", pid);
          return parseInt(pid, 10);
        } else {
          return null;
        }
      })
      .catch(() => {
        return null;
      });
  } else {
    throw new Error("Not implemented");
  }
}

async function spawnMain() {
  if ((await findMainPID()) !== null) {
    return;
  }
  console.log("spawnning main process...");
  const subprocess = cp.spawn("./thirdparty/rustdesk.exe", [], {
    detached: true,
    stdio: "ignore",
    cwd: __dirname,
  });
  subprocess.unref();
  console.log("spawned main process");
}

/**
 * @param {string} [password]
 */
async function changePassword(password) {
  if (!password) {
    password = _generateRandomPassword();
  }
  if (!/^[a-zA-Z0-9]+$/.test(password)) {
    throw new Error("Invalid password");
  }
  if (os.platform() === "win32") {
    const subprocess = cp.spawn("./thirdparty/rustdesk.exe", ["--password", password], {
      cwd: path.join(__dirname),
      detached: true,
      stdio: "ignore",
    });
    subprocess.unref();
    console.log("Password changed to", password);
    return password;
  } else {
    throw new Error("Not implemented");
  }
}

function _generateRandomPassword() {
  return (~~(Math.random() * 2147483648)).toString(16).padStart(8, "0");
}

module.exports = {
  findMainPID,
  spawnMain,
  changePassword,
};
