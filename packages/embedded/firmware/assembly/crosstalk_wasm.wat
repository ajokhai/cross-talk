(module
  ;; ============================================================================
  ;; CrossTalk Micro WebAssembly (WASM) Engine
  ;; Hand-written WAT: header validation and XDialect prefix classification
  ;; with no allocation (the caller writes frames into linear memory).
  ;; Memory: 1 page (64KB) of linear memory
  ;; ============================================================================
  (memory (export "memory") 1)

  ;; Validates a v1 CrossTalk binary frame stored in linear memory at
  ;; [$offset, $offset + $len):
  ;;   [0x58 'X'][version 0x01][opcode][flags][timestamp u32 BE][payload_len u16 BE][payload...]
  ;; Returns:
  ;;   0 = Valid frame; the whole payload is inside $len
  ;;  -1 = Invalid Magic byte (must be 0x58 'X')
  ;;  -2 = Invalid Version (must be 0x01)
  ;;  -3 = Buffer too small (< 10 bytes)
  ;;  -4 = Partial frame: header is valid but $len < 10 + payload_len
  ;; (These codes predate the C/Thumb ones, which use -1 short, -2 bad header,
  ;; -3 partial. They are kept so existing JS callers do not break.)
  ;; The caller must keep $offset + $len inside memory; out-of-range loads trap.
  (func (export "validate_header") (param $offset i32) (param $len i32) (result i32)
    ;; Check length >= 10
    (if (i32.lt_u (local.get $len) (i32.const 10))
      (then (return (i32.const -3)))
    )

    ;; Check Magic byte == 0x58 ('X')
    (if (i32.ne (i32.load8_u (local.get $offset)) (i32.const 88))
      (then (return (i32.const -1)))
    )

    ;; Check Version byte == 0x01
    (if (i32.ne (i32.load8_u (i32.add (local.get $offset) (i32.const 1))) (i32.const 1))
      (then (return (i32.const -2)))
    )

    ;; Partial frame: fewer than payload_len bytes after the 10-byte header
    (if (i32.lt_u
          (i32.sub (local.get $len) (i32.const 10))
          (call $payload_len (local.get $offset)))
      (then (return (i32.const -4)))
    )

    ;; Success
    (i32.const 0)
  )

  ;; Returns opcode at byte offset 2
  (func (export "get_opcode") (param $offset i32) (result i32)
    (i32.load8_u (i32.add (local.get $offset) (i32.const 2)))
  )

  ;; Returns big-endian payload length (bytes 8 & 9)
  (func $payload_len (export "get_payload_len") (param $offset i32) (result i32)
    (i32.or
      (i32.shl (i32.load8_u (i32.add (local.get $offset) (i32.const 8))) (i32.const 8))
      (i32.load8_u (i32.add (local.get $offset) (i32.const 9)))
    )
  )

  ;; Classifier for XDialect token prefixes:
  ;; '!' (0x21) -> 1 (Action: !LCK, !REL, !BCST, !PASS)
  ;; '#' (0x23) -> 2 (Intent: #REF, #FEAT, #FIX)
  ;; '&' (0x26) -> 3 (Flow: &WAIT, &ACK, &DONE)
  ;; '@' (0x40) -> 4 (Resource/File Target)
  ;; Other      -> 0 (Raw string / literal)
  (func (export "classify_prefix") (param $char_code i32) (result i32)
    (if (i32.eq (local.get $char_code) (i32.const 33)) (then (return (i32.const 1))))
    (if (i32.eq (local.get $char_code) (i32.const 35)) (then (return (i32.const 2))))
    (if (i32.eq (local.get $char_code) (i32.const 38)) (then (return (i32.const 3))))
    (if (i32.eq (local.get $char_code) (i32.const 64)) (then (return (i32.const 4))))
    (i32.const 0)
  )
)
