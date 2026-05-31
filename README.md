# HR 전자서명 수집 MVP

HR 담당자가 200~300명의 임직원에게 본인 전자서명을 요청하고, 임직원은 개인 링크에서 본인 문서만 확인한 뒤 수기 서명을 제출하는 사내 테스트용 MVP입니다.

## 1. PRD 요약

목표는 종이 서명 수집을 줄이고, 관리자 요청 생성부터 대상자별 링크 발송, 본인 서명 제출, 진행률 확인, CSV 다운로드, 감사로그 저장까지 한 흐름으로 검증하는 것입니다.

MVP 원칙:

- 대리서명 기능 없음
- 서명자는 본인 링크의 문서와 본인 정보만 조회
- 제출 후 수정 불가
- 토큰은 예측 불가능한 랜덤값 사용 및 만료일 관리
- 문서 원문, 서명 이미지, 완료 문서 기준 해시값 저장
- 감사로그에 제출 시각, user-agent, 동의 여부, 토큰 ID, 해시값 기록
- PDF 생성은 후순위이며 우선 CSV와 서명 이미지 저장 구조를 검증

## 2. DB 스키마 제안

주요 테이블:

- `users`: 관리자 계정과 역할
- `signature_campaigns`: 서명 요청 캠페인, 문서 내용, 문서 버전, 원본문서 해시
- `signature_recipients`: 대상자 개인정보 최소 필드, 상태, 토큰 해시, 만료일
- `signature_submissions`: 제출된 서명 이미지 경로, 서명 이미지 해시, 완료 문서 해시, 잠금 여부
- `audit_logs`: 법적/감사 추적에 필요한 서명 시점 스냅샷
- `email_logs`: 최초 발송/리마인드 메일 발송 기록

상태값:

- 대상자: `not_sent`, `sent`, `viewed`, `signed`, `expired`
- 캠페인: `draft`, `sending`, `active`, `completed`, `expired`

## 3. Supabase 테이블 생성 SQL

SQL은 [supabase/schema.sql](./supabase/schema.sql)에 있습니다.

설계 의도:

- RLS를 켜고 관리자는 전체 관리, 익명 서명자는 테이블 직접 조회 차단
- 서명자 페이지는 `get_signing_request(token)` RPC로 본인 문서만 조회
- 서명 제출은 `submit_signature(...)` RPC로 단일 트랜잭션 처리
- 원본 토큰은 DB에 저장하지 않고 `sha256(token)`만 저장하는 방식 권장
- 서명 이미지는 Supabase Storage 비공개 버킷에 저장하고 경로만 DB에 저장

## 4. 프론트엔드 라우팅 구조

해시 라우팅을 사용합니다.

- `#/login`: 관리자 로그인
- `#/admin`: 관리자 대시보드
- `#/campaigns/new`: 서명 요청 생성
- `#/campaigns/:id`: 요청 상세, 대상자 상태, 발송/리마인드/CSV
- `#/sign/:token`: 서명자 전용 화면
- `#/complete`: 서명 완료 화면

## 5. MVP 코드 구조

- [index.html](./index.html): 앱 엔트리
- [src/app.js](./src/app.js): React MVP 전체 화면과 로컬 저장소 어댑터
- [src/styles.css](./src/styles.css): 업무용 UI 스타일
- [supabase/schema.sql](./supabase/schema.sql): Supabase 테이블, RLS, RPC
- [build.js](./build.js): 정적 배포 파일 복사
- [serve.js](./serve.js): `dist/` 로컬 서빙

현재 프론트는 의존성 설치 없이 테스트할 수 있도록 React, ReactDOM, htm, lucide-react를 ESM CDN에서 불러옵니다. Supabase 환경값이 없으면 `localStorage` 데모 저장소로 동작합니다.

## 6. 실행 방법

빌드:

```bash
npm run build
```

로컬 실행:

```bash
npm run serve
```

브라우저에서 접속:

```text
http://localhost:4173
```

데모 로그인:

```text
hr@example.com
```

CSV 예시:

```csv
name,email,employee_no,department,title
홍길동,hong@example.com,10001,인사팀,매니저
김영희,kim@example.com,10002,재무팀,책임
```

## 7. 보안 TODO

이 MVP에서 의도적으로 단순화한 부분입니다. 운영 전 반드시 보완해야 합니다.

- TODO: Supabase Auth로 관리자 로그인과 `users.role = admin` 검증 연결
- TODO: 서명 링크 접속 후 회사 이메일 OTP 또는 magic link 인증 추가
- TODO: 원본 토큰을 프론트 저장소나 DB에 보관하지 않고 토큰 해시만 저장
- TODO: 이메일 발송은 Resend를 호출하는 Supabase Edge Function에서 처리
- TODO: 서명 이미지 업로드는 비공개 Storage 버킷과 서버 측 제출 RPC로 처리
- TODO: IP 주소는 클라이언트가 아니라 Edge Function 또는 서버 로그에서 기록
- TODO: 완료 PDF 생성 시 원본문서 해시, 서명 해시, 완료본 해시를 함께 검증
- TODO: 개인정보 보존기간, 다운로드 권한, 감사로그 열람 권한 정책 수립

## 8. MVP 검증 시나리오

1. 관리자 로그인
2. `요청 생성`에서 제목, 설명, 마감일, 문서 내용 입력
3. CSV 업로드 또는 대상자 직접 추가
4. 요청 저장
5. 상세 화면에서 `발송` 클릭
6. 대상자 개인 링크 복사
7. 새 탭에서 개인 링크 접속
8. 본인 정보와 문서 확인 후 체크박스 선택
9. 수기 서명 후 제출
10. 관리자 상세 화면에서 상태와 CSV 다운로드 확인
