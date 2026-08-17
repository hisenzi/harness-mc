# AI 貓咪短劇｜第一集正式腳本

> 集名：不是我，是昨天的我
> 版本：0.1 製作草案
> 預計片長：12 秒
> 畫面比例：9:16
> 狀態：文字與分鏡完成，尚未生成影像、配音或成片
> Work anchor：`adobe-creative-pipeline/acp-007`

## 1. 這一集的任務

用第一集讓觀眾在 12 秒內理解兩個角色：麥麥負責抓包，阿橘負責用歪理逃避；結尾以不真實、無傷害的「原地失重」建立系列招牌笑點。

核心笑點不是打架，而是阿橘認為「昨天的自己」和「今天的自己」不是同一個責任主體。

## 2. 正式對白

**麥麥：** 冰箱那個布丁罐罐呢？

**阿橘：** 不是我。

**麥麥：** 你嘴邊還沾著。

**阿橘：** 那是昨天的我吃的。

**麥麥：** 那今天的你，先飛一下。

**麥麥（看向畫外）：** 明天再問。

## 3. 時間碼與畫面設計

| 時間 | 鏡頭 | 畫面與動作 | 對白／字幕 | 聲音 | 生成策略 |
| --- | --- | --- | --- | --- | --- |
| 0.0–1.8 秒 | S01 對峙開場 | 固定全景。麥麥坐左側，向前伸頭；阿橘坐右側，保持鎮定。 | 麥麥：冰箱那個布丁罐罐呢？ | 安靜室內底噪 | 由共同 master frame 做 image-to-video；只讓麥麥做一次微小前傾。 |
| 1.8–3.0 秒 | S02 否認 | 同鏡位。阿橘慢眨一次眼，視線稍微移開。 | 阿橘：不是我。 | 低沉短句；停頓 0.2 秒 | 獨立短鏡頭；背景與兩隻貓位置不變。 |
| 3.0–4.8 秒 | S03 證據 | 麥麥盯著阿橘嘴邊；右前腳抬起約 5 公分，指向一小點布丁痕跡。 | 麥麥：你嘴邊還沾著。 | 一聲很輕的提示音 | 只生成麥麥抬腳和阿橘僵住，不做接觸。布丁痕跡可後製加上。 |
| 4.8–7.0 秒 | S04 歪理 | 阿橘保持面無表情，緩慢把頭轉回來。 | 阿橘：那是昨天的我吃的。 | 語速慢；句尾留 0.3 秒 | 以阿橘為主要動作角色；麥麥保持近乎靜止。 |
| 7.0–8.8 秒 | S05 判決 | 麥麥定睛，右前腳靠近阿橘肩膀但不真正打擊。 | 麥麥：那今天的你，先飛一下。 | 音樂在「飛」字前完全停下 | 產生反轉前的 first keyframe，固定所有角色特徵與場景。 |
| 8.8–10.6 秒 | S06 失重反轉 | 輕微「啪」後，阿橘完整身體以柔和失重方式往畫面右上方平移，離開沙發；麥麥仍坐在原位。 | 無字幕 | 輕拍聲 → whoosh → 遠處柔和「噗」 | 首尾關鍵影格：第一格為麥麥腳靠近阿橘；最後格為阿橘完整、無受傷地漂到畫面右上方。禁止模型生成真實抓咬。 |
| 10.6–12.0 秒 | S07 冷靜收尾 | 麥麥看向右側畫外，慢眨一次，再轉回原本角度。 | 麥麥：明天再問。 | 0.5 秒安靜收尾 | 獨立反應鏡頭；最後硬切回 S01 第一格形成循環。 |

總長：12.0 秒。

## 4. 每鏡動態提示詞

共同前綴使用角色設定文件的固定生成限制；以下只描述各鏡頭唯一主要動作。

### S01

```text
The petite calico cat on the left leans her head and upper body forward slightly as if asking a serious question. The large orange-and-white cat on the right remains seated and still. One subtle action only, locked-off camera.
```

### S02

```text
The large orange-and-white cat slowly blinks once, then shifts his eyes slightly away with a calm deadpan expression. The petite calico cat remains still. One subtle action only, locked-off camera.
```

### S03

```text
The petite calico cat raises her right front paw about five centimeters and points toward the orange cat's muzzle without touching him. The orange cat freezes. No attack, no fast motion, locked-off camera.
```

### S04

```text
The large orange-and-white cat slowly turns his head back toward the petite calico cat with complete confidence and a deadpan expression. Both cats stay seated, locked-off camera.
```

### S05–S06 首尾關鍵影格轉場

```text
Comedic cartoon physics in a photorealistic pet video: after a very gentle paw touch near the shoulder, the large orange-and-white cat becomes weightless and smoothly drifts diagonally toward the upper-right edge of frame while keeping his body anatomically correct and showing no pain or fear. The petite calico cat stays seated on the sofa. No impact, no injury, no biting, no camera movement, sofa and background remain unchanged.
```

### S07

```text
The petite calico cat calmly looks toward the empty space on the right, blinks once, then returns her gaze to the original forward angle. Minimal motion, locked-off camera.
```

## 5. 字幕規格

- 語言：第一版只使用繁體中文。
- 字體方向：粗黑體，白字、黑色外框，不加彩色漸層。
- 位置：畫面下方約 65–78% 高度，避開 Instagram 操作介面。
- 每行：最多 10 個中文字；必要時切成兩行。
- 出現時機：聲音開始前 0.1 秒出現，聲音結束後 0.1 秒消失。
- 生成影片不得包含字幕；全部在剪輯軟體後製。

字幕切行：

```text
冰箱那個
布丁罐罐呢？

不是我。

你嘴邊
還沾著。

那是昨天的我
吃的。

那今天的你，
先飛一下。

明天再問。
```

## 6. 聲音設計

- 麥麥：清楚、偏高、語速快；不做尖叫。
- 阿橘：低沉、慢、面無表情；「昨天」稍微加重。
- 室內底噪維持很低，讓對白成為主體。
- 反轉前 0.2 秒抽掉所有背景聲，製造停頓。
- 失重效果使用輕拍聲與柔和 whoosh，不用痛叫、撞擊或骨折類音效。
- 第一版不要求嘴型同步；把聲音處理成角色內心對白。

## 7. 剪輯與循環

1. 每個 AI 片段只取最穩定的 1.2–2.2 秒，不保留生成前後的漂移幀。
2. 所有鏡頭維持同一機位；必要時用 2–4 幀快速切換掩蓋角色姿勢差。
3. S05 的「飛」字落下後延遲 0.1 秒才播放輕拍聲。
4. S06 的 whoosh 在阿橘開始移動時播放，不等他離開畫面。
5. S07 最後一幀直接硬切至 S01 第一幀，不加淡出。

## 8. 發布文字草案

封面短句：`昨天的我吃的`

貼文文字：

```text
犯錯的不是我，是昨天的我。
今天的我只負責飛走。
```

Hashtags 僅作初稿：`#AI貓咪 #貓咪短劇 #寵物喜劇 #短影音`

## 9. 原創與安全邊界

- 不使用參考 Reel 的原音、字幕句子、帳號標誌或角色名稱。
- 本集保留「日常對峙＋不合物理的收尾」類型結構，但劇情、角色、對白與視覺記號均重新設計。
- 飛行效果明確是卡通失重，不呈現真實動物受傷或鼓勵對寵物施暴。
- 發布前需人工確認生成畫面沒有多腳、融合、驚恐表情或碰撞傷害暗示。

## 10. 驗收對照

- `ACP07-CAT-02` 時長：12.0 秒，符合 10–15 秒。
- Hook：0–1.8 秒直接提出罐罐失蹤。
- 衝突：1.8–8.8 秒依序為否認、證據、歪理、判決。
- 反轉：8.8–10.6 秒，以首尾關鍵影格完成無傷害失重。
- 收尾：10.6–12.0 秒冷靜反應並硬切回開場。
- 字幕：全部後製，靜音閱讀仍可理解完整情節。
- 尚未驗收：實際角色 reference、生成鏡頭、聲音、字幕安全區、循環與成片品質。
