@echo off

chcp 65001
powershell -Command "pm2 --version" && goto :task

echo "The above error shows that pm2 is not installed."
echo "Installing pm2..."
regedit.exe /S %cd%\ps-policy.reg
powershell -Command "npm i -g yarn pm2"
powershell -Command "yarn config set registry https://registry.npm.taobao.org"
powershell -Command "yarn install"
echo "done."

:task
powershell -Command "npm i -g yarn"
powershell -Command "yarn"
node ./start-up.js

pause
