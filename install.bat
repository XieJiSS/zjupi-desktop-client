@echo off

chcp 65001
powershell -Command "pm2 --version" && goto :task

echo "The above error shows that pm2 is not installed."
echo "Installing pm2..."
regedit.exe /S %cd%\ps-policy.reg
npm i --location=global yarn
yarn config set registry https://registry.npm.taobao.org
yarn global add pm2
echo "安装成功。"

:task
yarn
node ./start-up.js

pause
