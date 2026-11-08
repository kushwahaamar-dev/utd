/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/iynk_passport.json`.
 */
export type IynkPassport = {
  "address": "BYFLDTLNi946Z8jT4JnxgE8Cpzkr9ud7tSrnThFTv31w",
  "metadata": {
    "name": "iynkPassport",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "iynk Proof of Build: verified skill credentials and escrowed sponsor bounties"
  },
  "instructions": [
    {
      "name": "cancelBounty",
      "docs": [
        "Closes an unclaimed bounty and returns everything it holds to the sponsor."
      ],
      "discriminator": [
        79,
        65,
        107,
        143,
        128,
        165,
        135,
        46
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "bounty.sponsor",
                "account": "bounty"
              },
              {
                "kind": "account",
                "path": "bounty.skill_hash",
                "account": "bounty"
              },
              {
                "kind": "account",
                "path": "bounty.nonce",
                "account": "bounty"
              }
            ]
          }
        },
        {
          "name": "sponsor",
          "writable": true,
          "signer": true,
          "relations": [
            "bounty"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "cancelRace",
      "docs": [
        "Cancels an unfinished race and returns the seed to its creator."
      ],
      "discriminator": [
        223,
        214,
        232,
        232,
        43,
        15,
        165,
        234
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true
        },
        {
          "name": "signer",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "closeRace",
      "docs": [
        "Oracle only: stops new entries now."
      ],
      "discriminator": [
        43,
        141,
        231,
        200,
        195,
        209,
        100,
        140
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "race"
          ]
        }
      ],
      "args": []
    },
    {
      "name": "createBounty",
      "docs": [
        "Escrows `amount` lamports for whoever next earns `skill_id`",
        "(or only `learner`, when set)."
      ],
      "discriminator": [
        122,
        90,
        14,
        143,
        8,
        125,
        200,
        2
      ],
      "accounts": [
        {
          "name": "bounty",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  98,
                  111,
                  117,
                  110,
                  116,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "sponsor"
              },
              {
                "kind": "arg",
                "path": "skillHash"
              },
              {
                "kind": "arg",
                "path": "nonce"
              }
            ]
          }
        },
        {
          "name": "sponsor",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        },
        {
          "name": "skillHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "learner",
          "type": {
            "option": "pubkey"
          }
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "nonce",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createRace",
      "docs": [
        "Opens a prize race. The creator may seed the pot with `seed_lamports`."
      ],
      "discriminator": [
        233,
        107,
        148,
        159,
        241,
        155,
        226,
        54
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "arg",
                "path": "raceId"
              }
            ]
          }
        },
        {
          "name": "creator",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "raceId",
          "type": "u64"
        },
        {
          "name": "entryLamports",
          "type": "u64"
        },
        {
          "name": "trackHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "closesAt",
          "type": "i64"
        },
        {
          "name": "seedLamports",
          "type": "u64"
        }
      ]
    },
    {
      "name": "enterRace",
      "docs": [
        "Pays the entry fee into the pot and registers the signer as an entrant."
      ],
      "discriminator": [
        242,
        118,
        55,
        253,
        83,
        235,
        115,
        31
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "race"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "docs": [
        "Creates the Config PDA. Only the program's upgrade authority may call it."
      ],
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "admin",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "programData",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  156,
                  150,
                  20,
                  43,
                  52,
                  125,
                  173,
                  149,
                  254,
                  244,
                  83,
                  247,
                  155,
                  95,
                  66,
                  186,
                  44,
                  101,
                  174,
                  250,
                  255,
                  202,
                  222,
                  79,
                  12,
                  143,
                  31,
                  85,
                  227,
                  210,
                  53,
                  38
                ]
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                2,
                168,
                246,
                145,
                78,
                136,
                161,
                176,
                226,
                16,
                21,
                62,
                247,
                99,
                174,
                43,
                0,
                194,
                185,
                61,
                22,
                193,
                36,
                210,
                192,
                83,
                122,
                16,
                4,
                128,
                0,
                0
              ]
            }
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "issuer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "issueCredential",
      "docs": [
        "Records a verified credential and pays every bounty passed in",
        "`remaining_accounts` (each writable, same skill, unclaimed, open or",
        "reserved for this learner)."
      ],
      "discriminator": [
        255,
        193,
        171,
        224,
        68,
        171,
        194,
        87
      ],
      "accounts": [
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "credential",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  114,
                  101,
                  100
                ]
              },
              {
                "kind": "account",
                "path": "learner"
              },
              {
                "kind": "arg",
                "path": "skillHash"
              }
            ]
          }
        },
        {
          "name": "learner",
          "docs": [
            "payouts, and the owner check keeps program accounts out."
          ],
          "writable": true
        },
        {
          "name": "issuer",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "skillId",
          "type": "string"
        },
        {
          "name": "skillHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "replayHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "score",
          "type": "u16"
        }
      ]
    },
    {
      "name": "refundEntry",
      "docs": [
        "Returns an entrant's fee after the race was cancelled."
      ],
      "discriminator": [
        214,
        5,
        136,
        23,
        253,
        7,
        230,
        81
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "race"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "player",
          "writable": true,
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "setIssuer",
      "docs": [
        "Rotates the key allowed to issue credentials."
      ],
      "discriminator": [
        122,
        240,
        209,
        127,
        179,
        164,
        175,
        206
      ],
      "accounts": [
        {
          "name": "admin",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "issuer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "settle",
      "docs": [
        "Pays the pot to the podium (50/30/20, renormalised for fewer finishers)",
        "in one transaction. `remaining_accounts`: a (wallet, entry) pair per winner."
      ],
      "discriminator": [
        175,
        42,
        185,
        87,
        144,
        131,
        102,
        212
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "settler",
          "signer": true
        }
      ],
      "args": []
    },
    {
      "name": "submitResult",
      "docs": [
        "Oracle only: records a verified lap for an entrant and updates the podium."
      ],
      "discriminator": [
        240,
        42,
        89,
        180,
        10,
        239,
        9,
        214
      ],
      "accounts": [
        {
          "name": "race",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  114,
                  97,
                  99,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "race.race_id",
                "account": "race"
              }
            ]
          }
        },
        {
          "name": "entry",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  101,
                  110,
                  116,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "race"
              },
              {
                "kind": "account",
                "path": "player"
              }
            ]
          }
        },
        {
          "name": "player"
        },
        {
          "name": "authority",
          "signer": true,
          "relations": [
            "race"
          ]
        }
      ],
      "args": [
        {
          "name": "lapMs",
          "type": "u32"
        },
        {
          "name": "runHash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "bounty",
      "discriminator": [
        237,
        16,
        105,
        198,
        19,
        69,
        242,
        234
      ]
    },
    {
      "name": "config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "credential",
      "discriminator": [
        145,
        44,
        68,
        220,
        67,
        46,
        100,
        135
      ]
    },
    {
      "name": "entry",
      "discriminator": [
        63,
        18,
        152,
        113,
        215,
        246,
        221,
        250
      ]
    },
    {
      "name": "race",
      "discriminator": [
        114,
        93,
        186,
        119,
        99,
        123,
        162,
        192
      ]
    }
  ],
  "events": [
    {
      "name": "bountyPaid",
      "discriminator": [
        60,
        72,
        10,
        171,
        122,
        59,
        238,
        148
      ]
    },
    {
      "name": "credentialIssued",
      "discriminator": [
        194,
        216,
        28,
        159,
        89,
        29,
        72,
        177
      ]
    },
    {
      "name": "entryRefunded",
      "discriminator": [
        34,
        82,
        130,
        116,
        93,
        139,
        188,
        234
      ]
    },
    {
      "name": "raceCancelled",
      "discriminator": [
        211,
        217,
        124,
        48,
        45,
        246,
        250,
        44
      ]
    },
    {
      "name": "raceCreated",
      "discriminator": [
        92,
        229,
        121,
        9,
        205,
        210,
        225,
        9
      ]
    },
    {
      "name": "raceEntered",
      "discriminator": [
        225,
        152,
        64,
        182,
        188,
        220,
        210,
        240
      ]
    },
    {
      "name": "racePayout",
      "discriminator": [
        79,
        103,
        209,
        68,
        254,
        249,
        217,
        178
      ]
    },
    {
      "name": "raceSettled",
      "discriminator": [
        182,
        88,
        145,
        67,
        233,
        56,
        43,
        181
      ]
    },
    {
      "name": "resultSubmitted",
      "discriminator": [
        156,
        153,
        163,
        89,
        245,
        144,
        63,
        94
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "notUpgradeAuthority",
      "msg": "Only the program's upgrade authority can initialize the config"
    },
    {
      "code": 6001,
      "name": "notAdmin",
      "msg": "Only the config admin can do this"
    },
    {
      "code": 6002,
      "name": "notIssuer",
      "msg": "Only the configured issuer can issue credentials"
    },
    {
      "code": 6003,
      "name": "notSponsor",
      "msg": "Only the bounty's sponsor can cancel it"
    },
    {
      "code": 6004,
      "name": "skillIdLength",
      "msg": "skill_id must be 1 to 64 bytes"
    },
    {
      "code": 6005,
      "name": "skillIdCharset",
      "msg": "skill_id must be printable ASCII without spaces"
    },
    {
      "code": 6006,
      "name": "skillHashMismatch",
      "msg": "skill_hash must be sha256 of skill_id"
    },
    {
      "code": 6007,
      "name": "learnerNotWallet",
      "msg": "The learner must be a wallet (an account owned by the System Program)"
    },
    {
      "code": 6008,
      "name": "bountyTooSmall",
      "msg": "A bounty must hold at least the rent-exempt minimum of an empty account"
    },
    {
      "code": 6009,
      "name": "bountyNotWritable",
      "msg": "Bounty accounts must be passed as writable"
    },
    {
      "code": 6010,
      "name": "bountySkillMismatch",
      "msg": "The bounty is for a different skill"
    },
    {
      "code": 6011,
      "name": "bountyLearnerMismatch",
      "msg": "The bounty is reserved for a different learner"
    },
    {
      "code": 6012,
      "name": "bountyAlreadyClaimed",
      "msg": "The bounty has already been claimed"
    },
    {
      "code": 6013,
      "name": "notOracle",
      "msg": "Only the race's oracle can do this"
    },
    {
      "code": 6014,
      "name": "raceNotOpen",
      "msg": "The race is not open for entries"
    },
    {
      "code": 6015,
      "name": "raceClosed",
      "msg": "The race has closed"
    },
    {
      "code": 6016,
      "name": "raceNotClosed",
      "msg": "The race has not closed yet"
    },
    {
      "code": 6017,
      "name": "raceFinished",
      "msg": "The race is already settled or cancelled"
    },
    {
      "code": 6018,
      "name": "raceNotCancelled",
      "msg": "The race is not cancelled"
    },
    {
      "code": 6019,
      "name": "closesInPast",
      "msg": "closes_at must be in the future"
    },
    {
      "code": 6020,
      "name": "entryTooSmall",
      "msg": "The entry fee is below the minimum for a race"
    },
    {
      "code": 6021,
      "name": "invalidLap",
      "msg": "lap_ms must be greater than zero"
    },
    {
      "code": 6022,
      "name": "noFinishers",
      "msg": "Nobody has a verified result yet"
    },
    {
      "code": 6023,
      "name": "settleTooEarly",
      "msg": "Only the oracle can settle until the grace period after closing has passed"
    },
    {
      "code": 6024,
      "name": "badPayoutAccounts",
      "msg": "settle needs one (wallet, entry) pair of writable accounts per podium place"
    },
    {
      "code": 6025,
      "name": "payoutMismatch",
      "msg": "A payout account does not match the podium"
    },
    {
      "code": 6026,
      "name": "entryAlreadyPaid",
      "msg": "This entry was already paid or refunded"
    },
    {
      "code": 6027,
      "name": "notCreator",
      "msg": "Only the creator can cancel a race, and only before anyone enters"
    },
    {
      "code": 6028,
      "name": "overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "bounty",
      "docs": [
        "PDA [\"bounty\", sponsor, skill_hash, nonce as u64 little-endian].",
        "Holds its rent plus `amount` lamports until it is claimed or cancelled."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "sponsor",
            "type": "pubkey"
          },
          {
            "name": "skillHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "skillId",
            "type": "string"
          },
          {
            "name": "learner",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "claimedBy",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "bountyPaid",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "bounty",
            "type": "pubkey"
          },
          {
            "name": "learner",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "config",
      "docs": [
        "PDA [\"config\"]."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "credential",
      "docs": [
        "PDA [\"cred\", learner, skill_hash]. One per learner and skill; never transferable."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "learner",
            "type": "pubkey"
          },
          {
            "name": "skillHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "skillId",
            "type": "string"
          },
          {
            "name": "replayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "score",
            "type": "u16"
          },
          {
            "name": "issuedAt",
            "type": "i64"
          },
          {
            "name": "issuer",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "credentialIssued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "learner",
            "type": "pubkey"
          },
          {
            "name": "skillId",
            "type": "string"
          },
          {
            "name": "replayHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "score",
            "type": "u16"
          }
        ]
      }
    },
    {
      "name": "entry",
      "docs": [
        "PDA [\"entry\", race, player]. One per player and race."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "lapMs",
            "docs": [
              "Best verified lap in milliseconds, 0 until a result is submitted."
            ],
            "type": "u32"
          },
          {
            "name": "runHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "verified",
            "type": "bool"
          },
          {
            "name": "paid",
            "docs": [
              "Set once the player has been paid a prize or refunded."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "entryRefunded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "placing",
      "docs": [
        "One slot of the podium. `lap_ms == 0` means the slot is empty."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "lapMs",
            "type": "u32"
          },
          {
            "name": "runHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "race",
      "docs": [
        "PDA [\"race\", race_id as u64 little-endian].",
        "Holds its rent plus `pot` lamports (seed plus entry fees) until it settles or cancels."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "raceId",
            "type": "u64"
          },
          {
            "name": "authority",
            "docs": [
              "The oracle (the config issuer when the race was created) that submits results."
            ],
            "type": "pubkey"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "seedLamports",
            "type": "u64"
          },
          {
            "name": "trackHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "closesAt",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": {
                "name": "raceStatus"
              }
            }
          },
          {
            "name": "entryCount",
            "type": "u32"
          },
          {
            "name": "top3",
            "type": {
              "array": [
                {
                  "defined": {
                    "name": "placing"
                  }
                },
                3
              ]
            }
          },
          {
            "name": "pot",
            "type": "u64"
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "raceCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "refundable",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "raceCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "raceId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "pubkey"
          },
          {
            "name": "entryLamports",
            "type": "u64"
          },
          {
            "name": "seedLamports",
            "type": "u64"
          },
          {
            "name": "trackHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "closesAt",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "raceEntered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "entryCount",
            "type": "u32"
          },
          {
            "name": "pot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "racePayout",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "raceSettled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "pot",
            "type": "u64"
          },
          {
            "name": "payouts",
            "type": {
              "vec": {
                "defined": {
                  "name": "racePayout"
                }
              }
            }
          }
        ]
      }
    },
    {
      "name": "raceStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "open"
          },
          {
            "name": "closed"
          },
          {
            "name": "settled"
          },
          {
            "name": "cancelled"
          }
        ]
      }
    },
    {
      "name": "resultSubmitted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "race",
            "type": "pubkey"
          },
          {
            "name": "player",
            "type": "pubkey"
          },
          {
            "name": "lapMs",
            "type": "u32"
          },
          {
            "name": "runHash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "improved",
            "docs": [
              "False when the player already had a faster verified lap."
            ],
            "type": "bool"
          },
          {
            "name": "rank",
            "docs": [
              "Zero-based podium rank after this result, or 255 when outside the top three."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ],
  "constants": [
    {
      "name": "bountySeed",
      "type": "bytes",
      "value": "[98, 111, 117, 110, 116, 121]"
    },
    {
      "name": "configSeed",
      "type": "bytes",
      "value": "[99, 111, 110, 102, 105, 103]"
    },
    {
      "name": "credentialSeed",
      "type": "bytes",
      "value": "[99, 114, 101, 100]"
    },
    {
      "name": "entrySeed",
      "type": "bytes",
      "value": "[101, 110, 116, 114, 121]"
    },
    {
      "name": "raceSeed",
      "type": "bytes",
      "value": "[114, 97, 99, 101]"
    }
  ]
};
