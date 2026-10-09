(module
  ;; ============================================================================
  ;; CrossTalk Micro WebAssembly (WASM) Engine
  ;; Hand-crafted WAT for zero-allocation, sub-microsecond token parsing.
  ;; Memory: 1 page (64KB) of linear memory
  ;; ============================================================================
  (memory (export "memory") 1)

  ;; Validates the 10-byte CrossTalk binary frame header.
  ;; Returns:
  ;;   0 = Valid CrossTalk packet
  ;;  -1 = Invalid Magic byte (must be 0x58 'X')
  ;;  -2 = Invalid Version (must be 0x01)
  ;;  -3 = Buffer too small (< 10 bytes)
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

    ;; Success
    (i32.const 0)
  )

  ;; Returns opcode at byte offset 2
  (func (export "get_opcode") (param $offset i32) (result i32)
    (i32.load8_u (i32.add (local.get $offset) (i32.const 2)))
  )

  ;; Returns big-endian payload length (bytes 8 & 9)
  (func (export "get_payload_len") (param $offset i32) (result i32)
    (i32.or
      (i32.shl (i32.load8_u (i32.add (local.get $offset) (i32.const 8))) (i32.const 8))
      (i32.load8_u (i32.add (local.get $offset) (i32.const 9)))
    )
  )

  ;; Single-cycle classifier for XDialect token prefixes:
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
