// @ts-check

const address = require("address");
const { networkInterfaces } = require("os");
const { Netmask } = require("netmask");
const serverHost = process.env.HOST;
const serverNetmask = process.env.HOST_NETMASK;

/**
 * @type {string | null}
 */
let cachedLocalIP = null;

/**
 * @returns {string | void}
 */
function getLocalIP() {
  if (cachedLocalIP) {
    // make sure that the result IP is consistent, even if the network interface changes.
    // The process need to be restarted if such a change happens, and should not stay in
    // a state where the IP is not consistent.
    return cachedLocalIP;
  }

  const wlanInterface = process.env["WLAN_INTERFACE"];
  console.log("pre-configured wlan interface name is", wlanInterface);
  const block = new Netmask(`${serverHost}/${serverNetmask}`);

  if (wlanInterface) {
    const ip = address.ip(wlanInterface);
    if (ip && block.contains(ip)) {
      cachedLocalIP = ip;
      return ip;
    }
    console.error("wrong subnet:", ip, "not in", `${serverHost}/${serverNetmask}`);
  }

  const interfaces = networkInterfaces();
  const wlanInterfacePrefix = process.env["WLAN_INTERFACE_PREFIX"];

  if (wlanInterfacePrefix) {
    for (const [name, info] of Object.entries(interfaces)) {
      if (!info) continue;
      if (name.startsWith(wlanInterfacePrefix)) {
        for (const item of info) {
          if (item.family === "IPv4") {
            const ip = item.address;
            if (block.contains(ip)) {
              console.log("guessed wlan IP:", ip, name);
              cachedLocalIP = ip;
              return ip;
            }
          }
        }
      }
    }
  }
  for (const [name, info] of Object.entries(interfaces)) {
    if (!info) continue;
    for (const item of info) {
      if (item.family === "IPv4") {
        const ip = item.address;
        if (block.contains(ip)) {
          console.log("guessed wlan IP with low confidence:", ip, name);
          cachedLocalIP = ip;
          return ip;
        }
      }
    }
  }
  console.error("failed to guess wlan IP");
  return;
}

module.exports = {
  getLocalIP,
};
