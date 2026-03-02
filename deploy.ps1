Write-Host "==> Git Add"
git add -A

Write-Host "==> Git Commit"
git commit -m "auto deploy"

Write-Host "==> Git Push"
git push origin main

Write-Host "==> SSH Deploy"
ssh -i C:\Users\yaser\.ssh\id_rsa_instaapp -o IdentitiesOnly=yes mahsum@168.231.125.93 "/home/mahsum/instaapp/deploy.sh"

Write-Host "==> Deploy Finished"