# Git 커밋 메시지 인코딩 문제 해결

## 문제
Git 커밋 메시지가 깨져서 보이는 문제가 발생했습니다.

## 해결 방법

### 1. PowerShell 프로필 설정 (완료됨)
PowerShell 프로필에 UTF-8 인코딩 설정이 추가되었습니다.
**새 PowerShell 창을 열면** 커밋 메시지가 제대로 표시됩니다.

### 2. 커밋 메시지 수정 (선택사항)
커밋 메시지를 수정하려면 다음 명령어를 사용하세요:

```powershell
cd "c:\Users\cjun0\AppData\Local\spicetify\CustomApps\lyrics-plus"

# 현재 커밋 메시지 수정
git commit --amend -m "번역 프롬프트 개선: 더 자연스러운 한국어 번역을 위한 가이드라인 추가"

# 또는 여러 커밋 수정
git rebase -i HEAD~2
# 에디터에서 'pick'을 'reword'로 변경하고 저장
```

### 3. Git 설정 확인
다음 명령어로 Git 인코딩 설정을 확인하세요:

```powershell
git config --global --get i18n.commitEncoding
git config --global --get i18n.logOutputEncoding
```

### 4. 새 PowerShell 창에서 확인
새 PowerShell 창을 열고 다음 명령어를 실행하세요:

```powershell
cd "c:\Users\cjun0\AppData\Local\spicetify\CustomApps\lyrics-plus"
git log --oneline -5
```

이제 커밋 메시지가 제대로 표시될 것입니다.






