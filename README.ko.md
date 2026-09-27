<p align="center"><img src="https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/banner.png" alt="omo-usage" width="100%"></p>

# omo-usage

[English](README.md) | **한국어**

지금 쓰는 모델의 **남은 사용량**을 OMO Native 하단 표시줄에 보여줍니다.
모델을 바꾸면 따라 바뀌고, 사용량을 알 수 없는 모델에서는 표시하지 않습니다.

![Kiro, 넉넉함](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/kiro.png)
![ChatGPT 구독, 절반 정도 남음](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/chatgpt.png)
![거의 소진](https://raw.githubusercontent.com/asmond-lab/omo-usage/main/assets/low.png)

## 설치

```sh
omo install https://github.com/asmond-lab/omo-usage
```

설치 후 `omo`를 실행하세요(이미 열린 세션은 `/reload`).

## 지원

| OMO provider | 표시 내용 |
|---|---|
| `kiro` ([omo-kiro](https://github.com/asmond-lab/omo-kiro) 사용 시) | 이번 달 남은 크레딧 (예: `3,542 / 5,000`) |
| `chatgpt-subscription` | 주간 한도 남은 양 (한도가 두 개면 더 빠듯한 쪽) |
| `anthropic-subscription` | 5시간·7일 한도 중 더 빠듯한 쪽 |
| `openrouter` | 키에 걸린 사용 한도 남은 금액 (한도가 있는 키만) |
| `vercel-ai-gateway` | 남은 크레딧 |

그 밖의 provider(`xai`, `anthropic` 등 API 키 방식)는 분당 한도만 알려주고 남은 양은 알려주지 않아 표시하지 않습니다.

## 색

| 남은 양 | 색 |
|---|---|
| 50% 초과 | 초록 |
| 20~50% | 주황 |
| 20% 미만 | 빨강 + **곧 소진** |

## 알아둘 점

- OMO에 이미 로그인된 정보를 그대로 씁니다. 따로 설정할 것이 없고, 아무것도 저장하지 않습니다.
- 세션 시작, 모델 변경, 답변이 끝날 때 새로 조회합니다(1분에 한 번까지).
- ChatGPT·Claude 구독 수치는 공식 앱이 쓰는 주소에서 가져옵니다. 공개 API가 아니라 바뀔 수 있고, 바뀌면 해당 provider만 표시되지 않습니다.
- Kiro·ChatGPT·OpenRouter·Vercel은 실제 계정으로 확인했습니다. Claude 구독은 다른 동작하는 클라이언트와 같은 방식으로 만들었지만, 실제 Claude 계정으로는 아직 확인하지 못했습니다.

테스트: `bun test tests`

## 라이선스

MIT
