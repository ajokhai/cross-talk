# @cross-talk/dialect-zh

Chinese mode (中文支持) for XDialect shorthand. Parsing and English stay in `cross-talk`'s `DialectEngine`. This package adds the Chinese strings.

```ts
import { toChinese, fromChinese, ZH_TOKENS } from '@cross-talk/dialect-zh';

toChinese('!LCK @src/auth.ts #REF "jwt" ~180 &WAIT');
// 正在编辑 "src/auth.ts"，进行代码重构（jwt）。 （保持锁定 180 秒）。 请稍候，等我修改完成再操作。

fromChinese('正在修改 src/auth.ts 重构，请稍候');
// !LCK @src/auth.ts #REF &WAIT
```

`fromChinese` passes text with no Chinese characters to `DialectEngine.fromHuman`.
