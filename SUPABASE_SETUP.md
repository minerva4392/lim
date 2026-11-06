# Supabase 설정

1. Supabase 프로젝트를 만든 뒤 SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
2. Authentication의 Email provider 설정에서 Confirm email을 끕니다. 이 설정이면 가입 후 이메일 확인 없이 로그인할 수 있습니다.
3. Project Connect에서 Project URL과 publishable key를 복사해 `supabase-config.js`에 넣습니다. Secret/service role 키는 브라우저 코드에 넣지 않습니다.
4. `index.html`을 `file://`로 열지 말고 VS Code Live Server 같은 로컬 웹 서버로 실행합니다.

게임은 계정이 생명력을 모두 잃고 작전이 끝날 때 최고 도달 점수를 `game_records`에 저장합니다. 순위표는 사용자별 최고 점수 한 건을 보여줍니다. 점수 계산이 브라우저에서 진행되므로, 공개 서비스에서 부정 점수를 막으려면 서버에서 전투와 점수를 검증하는 Edge Function이 추가로 필요합니다.
