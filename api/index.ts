/**
 * Vercel 서버리스 함수 진입점.
 *
 * 실제 구현은 apps/api 에 있다. 이 파일이 저장소에 그대로 있어야 하는 이유는
 * Vercel 이 빌드를 돌리기 **전에** api/ 를 훑어 함수를 찾기 때문이다.
 * 빌드 중에 만들어 두는 방식은 "함수를 찾을 수 없다"로 실패한다.
 */
export { default } from '../apps/api/src/serverless.js';
