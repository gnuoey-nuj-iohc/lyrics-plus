# Git 커밋 메시지 인코딩 수정
$ErrorActionPreference = "Stop"

# UTF-8 인코딩 설정
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

cd "c:\Users\cjun0\AppData\Local\spicetify\CustomApps\lyrics-plus"

# 커밋 메시지 수정
Write-Host "커밋 메시지를 수정합니다..." -ForegroundColor Yellow

# 현재 커밋의 실제 메시지 추출 (바이트로)
$commitHash = "39cac78"
$commitMsg = git log --format="%B" -1 $commitHash --encoding=UTF-8

# 커밋 메시지를 올바른 메시지로 수정
$newMsg = "번역 프롬프트 개선: 더 자연스러운 한국어 번역을 위한 가이드라인 추가"

# git commit --amend를 사용하여 메시지 수정
git commit --amend -m $newMsg --no-verify

Write-Host "커밋 메시지가 수정되었습니다." -ForegroundColor Green
Write-Host ""
Write-Host "수정된 커밋 메시지:" -ForegroundColor Cyan
git log --format="%h %s" -1




