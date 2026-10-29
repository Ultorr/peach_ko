/** 请求失败使用本地化原因，不初始化界面或路由状态。 */
import { koreanLabel } from '../korean-label';

export function requestErrorMessage(cause:any,status=0):string{
  const text=String(cause?.message??cause??'');
  const code=Number(status||cause?.status||text.match(/\b(400|401|403|404|408|409|413|429|500|502|503|504)\b/)?.[1]);
  const messages:Record<number,string>={400:"입력한 내용에 오류가 있습니다. 확인 후 다시 시도하세요.",401:"로그인이 만료되었습니다. 새로고침한 뒤 다시 로그인하세요.",403:"이 기기에서는 해당 작업을 실행할 수 없습니다. Peach를 실행 중인 컴퓨터에서 작업하세요.",404:"요청한 콘텐츠가 더 이상 없습니다. 목록을 새로고침하세요.",408:"요청 시간이 초과되었습니다. 잠시 후 다시 시도하세요.",409:"현재 상태에서는 실행할 수 없습니다. 새로고침한 뒤 다시 시도하세요.",413:"전송할 내용이 너무 큽니다. 수량을 줄인 뒤 다시 시도하세요.",429:"요청이 너무 잦습니다. 잠시 후 다시 시도하세요.",500:"Peach 서비스 처리에 실패했습니다. 다시 시도하고, 계속 실패하면 트레이 로그를 확인하세요.",502:"Peach 서비스에서 결과를 가져오지 못했습니다. 잠시 후 다시 시도하고, 계속 실패하면 트레이 로그를 확인하세요.",503:"Peach 서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도하세요.",504:"서비스 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요."};
  if(/Failed to fetch|fetch failed|NetworkError|Load failed|network request failed|ERR_CONNECTION/i.test(text))return "Peach 서비스에 연결할 수 없습니다. 네트워크 연결과 트레이 서비스 실행 상태를 확인하세요.";
  /* 正文里的 timeout 字样只在没有状态码时才算超时：500 的堆栈里常带着某个库的 timeout 参数名。 */
  if(cause?.name==='TimeoutError'||(!code&&/timed? ?out|timeout/i.test(text)))return "서비스 응답 시간이 초과되었습니다. 연결을 확인한 뒤 다시 시도하세요.";
  if(/[㐀-鿿가-힣]/.test(text)&&!/^(?:请求失败|요청 실패)\s*[（(]/.test(text))return koreanLabel(text);
  if(messages[code])return messages[code];
  return "작업을 완료하지 못했습니다. 다시 시도하고, 계속 실패하면 트레이 로그를 확인하세요.";
}
