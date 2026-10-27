# TagAlong 设计文档 (v0.2)

> 新西兰本地的「接龙 / 团购」平台。任何商家都可以注册，发布接龙链接到 Facebook、WhatsApp、微信等渠道，买家点开链接即可直接付款下单，然后取货或上课。
>
> 本文档是 Claude Code 实现代码时的唯一事实来源 (single source of truth)。如果设计有变更，先更新本文档，再改代码。

---

## 1. 产品定位

| | GrabOne | 微信接龙 | **TagAlong** |
|---|---|---|---|
| 谁能卖 | 平台审核的商家 | 任何群主 | **任何商家，自助注册** |
| 付款 | 平台统一收款 | 转账 + 手动对账 | **Stripe 在线付款，自动对账** |
| 分发 | 平台流量 | 微信群 | **公开链接，任意渠道分享** |
| 品类 | 优惠券 | 任意 | **零售商品 + 课程 / 活动** |

核心价值有三点：
- 商家用 3 分钟发布一条接龙
- 买家无需注册即可付款
- 商家不需要再核对转账截图

接龙分两种定价：**付费接龙**（走 Stripe 付款）和**免费报名**（如社区活动、试听课、讲座，体验和报名系统一样，不涉及付款）。

## 2. 用户角色

- **Merchant 商家**：注册账号，完成 Stripe 入驻，发布接龙，管理订单，核销取货，处理退款。
- **Buyer 买家**：MVP 阶段以访客 (guest) 身份下单，只需填写姓名、邮箱和手机号，通过带 token 的链接查看订单。
- **Admin 平台管理员**：审查商家、停用 / 恢复商家、下架接龙、查询订单、跟踪争议。管理员账号由种子脚本或 CLI 创建，不开放自助注册。

## 3. MVP 范围

**包含：**
1. 商家通过 Clerk 注册和登录（邮箱验证码或 Google），并维护商家资料
2. Stripe Connect 入驻流程，以及入驻状态同步
3. 接龙 (Listing) 的创建、编辑、发布、关闭，支持三种类型：RETAIL / SESSION / EVENT
4. 公开接龙页：SSR 渲染、OG 分享卡片、已接龙列表（姓名脱敏）、剩余数量显示
5. 下单流程：预占库存 → Stripe Checkout → webhook 确认付款 → 分配接龙序号
6. 商家订单管理：订单列表、筛选、导出 CSV、标记已取货 / 已上课、全额或部分退款
7. 邮件通知：买家下单确认，课程类订单附 .ics 日历文件
8. 中英双语界面 (zh-CN / en)
9. 精简版 Admin 后台：商家管理、接龙下架、订单查询、争议列表、审计日志
10. **免费报名**：接龙设为 FREE 时，不走 Stripe，提交后直接确认并分配序号；买家可通过链接自助取消报名；支持商家自定义报名字段（付费接龙同样可用）

**不包含（Phase 2）：** 配送（DELIVERY）、商家多人协作、成团人数门槛、学期套餐和周期课、候补名单、买家账号、评价与举报、优惠码、线下转账选项、原生 App、SSE 实时推送、Admin 风控规则引擎和管理员 2FA。

## 4. 关键决策 (ADR 摘要)

| # | 决策 | 原因 / 取舍 |
|---|---|---|
| D1 | 后端使用 **NestJS + PostgreSQL + Prisma**，前端使用 **Next.js (App Router)**，全部 TypeScript | 前后端统一语言；NestJS 的模块化结构适合这类业务。 |
| D2 | 采用 **Stripe Connect 的 direct charges**，商家账户拥有完整的 Stripe Dashboard，争议和损失由商家 / Stripe 承担（相当于原 Standard 账户；新 API 中通过 `controller` 属性配置） | 「任何人都能开店」意味着诈骗风险，平台不应成为 merchant of record 去承担 chargeback。**代价**是平台无法控制商家打款节奏。如果以后需要「取货后才打款」，再评估改为 Express + destination charges。 |
| D3 | 使用 **Stripe Checkout（托管页面）**，而不是自建支付表单 | 自带 Apple Pay / Google Pay，PCI 合规压力最小，开发最快。 |
| D4 | 采用 **下单即扣款** 的模式，MVP 不做成团门槛 | Stripe 预授权最多保留约 7 天，接龙周期往往更长。成团逻辑放到 Phase 2 再设计（方案：SetupIntent + off-session 扣款）。 |
| D5 | 平台收入通过 `application_fee_amount` 收取，费率可配置 (`PLATFORM_FEE_BPS`) | Stripe 的手续费由商家账户承担。 |
| D6 | 前端通过 Next.js rewrites 把 `/api/*` 代理到后端 | 前后端同源，httpOnly cookie 不会遇到跨域问题。 |
| D7 | API 契约采用 **OpenAPI**：后端用 `@nestjs/swagger` 生成，前端用 `openapi-typescript` 生成类型 | 前后端不维护手写的共享类型包。 |
| D8 | 金额一律使用 **整数分 (cents)**，币种 NZD，价格 **含 GST** | 新西兰零售的惯例是含税标价。 |
| D9 | 时间以 UTC 存储，展示时使用 `Pacific/Auckland` 时区 | 避免夏令时问题。 |
| D10 | **只做一个前端应用**，分为 `public` / `merchant` / `admin` 三个 surface，每个 surface 有独立的视觉风格（见 `docs/UI-STYLE.md`） | 共享组件、i18n 和 API client，只需部署一次。风格差异通过 CSS 变量和按路由组加载的字体实现。将来如果 admin 需要独立域名、IP 白名单或 SSO，再拆成单独的应用。 |
| D11 | **定价在接龙级别设置**：`pricing = FREE \| PAID`。FREE 接龙的所有 option 价格必须为 0，PAID 接龙的所有 option 价格必须大于 0，**不支持同一接龙里混合免费和付费** | 避免「订单总额为 0 但又要走 Stripe」等边界情况。如果有「免费试听 + 付费正式课」的需求，就发两条接龙。 |
| D12 | 商家**未完成 Stripe 入驻也可以发布免费接龙**；发布付费接龙必须先完成入驻 | 降低活动组织者的上手门槛。代价是免费接龙的商家没有经过 KYC，所以公开页上只给已完成 Stripe 入驻的商家显示「已验证」标识。 |
| D14 | **MVP 不做配送**：`fulfilment` 只有 `PICKUP \| ONSITE` | 配送需要配送费、配送范围、地址校验，这些都没有设计。先用自提覆盖团购场景，配送放到 Phase 2。 |
| D15 | **接龙页默认 `noindex`**，商家可以在设置里允许搜索引擎收录 | 接龙链接是半私密的，大多数商家只想发给自己的群。 |
| D16 | **所有邮件通过 Outbox 表异步发送**，webhook 和业务代码只写记录，不直接调用邮件服务 | 邮件服务超时不能影响 Stripe webhook 的处理，也不能丢失付款确认。 |
| D17 | **接龙取消的批量退款走异步任务**，逐笔记录结果 | 几十笔退款同步执行会超时，Stripe 也可能部分失败，必须可重试、可查看进度。 |
| D13 | **商家和 admin 都使用同一个 Clerk 应用（免费的 Hobby 档）**，通过角色区分。Clerk 负责注册、登录、会话和 JWT 签发，后端只负责验证 JWT 并做角色授权。**买家不注册**（继续以访客身份下单） | 只维护一套登录体系，商家和管理员的登录体验一致。免费档每个应用含 50,000 MRU，只有商家和管理员占用配额。**代价**是免费档没有 MFA，而 admin 权限很高（可以停用商家、退款），所以在接入真实资金之前，**必须升级到 Pro 并对 admin 强制开启 MFA**（见第 10 节和第 16 节）。admin 使用 `admin.tagalong.nz` 子域名，与主站同一个根域名，可以直接共享 Clerk 会话，不需要付费的 satellite domain 功能。 |

> ✅ 已核对（M2，Stripe 文档 `connect/migrate-to-controller-properties`）：D2 的 controller 组合（`stripe_dashboard=full`、`fees.payer=account`、`losses.payments=stripe`、`requirement_collection=stripe`）就是原 Standard 账户。这类账户**不能**生成 login link（只有 Express 可以），商家直接登录 dashboard.stripe.com。

## 5. 领域模型

```
User 1──1 Merchant 1──* Listing 1──* ListingOption
                              1──* PickupPoint
Listing 1──* Order 1──* OrderItem *──1 ListingOption
Order 1──* Refund
Listing 1──0..1 ListingCancellation 1──* RefundTask
NotificationOutbox (异步邮件)
StripeEvent (webhook 幂等表)
AuditLog (admin 与敏感操作留痕)
Merchant 1──* MerchantNote (admin 内部备注)
```

### 5.1 实体字段（Prisma 实现参考）

**User**
- `id`, `email`（仅在未删除用户中唯一：部分唯一索引 `WHERE deleted_at IS NULL`；已删除账户保留历史邮箱，同一邮箱可以重新注册）, `createdAt`
- `clerkUpdatedAt?`：最后一次应用的 Clerk `user.*` 事件的 `updated_at`，更早的事件一律忽略（webhook 可能乱序）
- `role`：取值 `MERCHANT` 或 `ADMIN`
- `clerkUserId` (unique)：所有用户都有
- `deletedAt?`
- **角色以我们自己的数据库为准**，同时同步一份到 Clerk 的 `publicMetadata.role`，供前端做路由判断（见第 9 节）
- 一个账号只能有一个角色：ADMIN 用户不能创建商家资料。员工如果需要测试，另外注册一个商家账号

**Merchant**
- 基本信息：`id`, `ownerUserId`, `slug` (unique), `displayName`, `description`, `logoUrl`, `contactEmail`, `contactPhone`, `gstNumber?`
- Stripe 状态：`stripeAccountId?`, `chargesEnabled`, `payoutsEnabled`, `detailsSubmitted`
- 商家状态 `status`：`ACTIVE | SUSPENDED`。商家资料创建后即为 ACTIVE；能否收款由 `chargesEnabled` 单独决定
- `createdAt`

**Listing**
- 基本信息：`id`, `merchantId`, `shortCode`（8 位，用于公开链接 `/l/{shortCode}`）, `title`, `description` (markdown), `images` (string[])
- `type`：`RETAIL | SESSION | EVENT`
- `fulfilment`：`PICKUP | ONSITE`（DELIVERY 留到 Phase 2）
- `status`：`DRAFT | PUBLISHED | CLOSED | CANCELLED`
- `opensAt?`, `closesAt?`（截止时间）
- `maxQtyPerOrder`
- `totalCapacity?`：接龙级别的总容量（可选），与 option 容量同时生效，例如「一共 30 份，任意规格组合」
- `soldCount`, `reservedCount`：接龙级别的计数器，与 option 级别的计数器在同一事务里更新
- `indexable` (bool，默认 false)：是否允许搜索引擎收录
- `pricing`：`FREE | PAID`（发布后不可修改）
- `showParticipants` (bool，默认 true)
- `formFields`：商家自定义的报名字段，json 数组，最多 10 个
  - 每个字段包含 `{ key, label, type, required, options? }`
  - `type` 可选 `text | textarea | number | select | multiselect | checkbox`
  - `scope` 为 `order`（每单填一次）或 `attendee`（每个名额都要填，例如每个孩子的年龄）
- `onePerEmail` (bool，FREE 默认 true)：同一邮箱在同一接龙中只能有一笔有效订单
- `allowSelfCancel` (bool，FREE 默认 true)：买家可在 `selfCancelUntil` 之前自助取消
- `selfCancelUntil?`：自助取消的截止时间，默认为活动开始前 2 小时
- `remindBeforeHours?`：活动开始前多少小时发提醒邮件，默认 24（仅 SESSION / EVENT）
- `policyText`（退款 / 取消政策，必填）
- `paidSeq` (int，接龙序号计数器)
- `publishedAt?`, `closedAt?`, `cancelledAt?`
- `createdAt`, `updatedAt`

**ListingOption**（规格或场次）
- `id`, `listingId`, `name`（如 "车厘子 2kg" 或 "周六 10:00 小组课"）
- `priceCents`：PAID 接龙最低 100（$1.00），上限 2,000,000（$20,000）；FREE 接龙固定为 0
- `capacity?`（null 表示不限量），修改时不能低于 `soldCount + reservedCount`
- `soldCount`, `reservedCount`
- `startsAt?`, `endsAt?`, `location?`（SESSION / EVENT 类型使用）
- `sortOrder`, `active`：发布后 option 不能删除，只能设为 `active=false`（已有订单仍然引用它）

**PickupPoint**
- `id`, `listingId`, `label`, `address`, `windowStart?`, `windowEnd?`, `notes?`

**Order**
- 标识：`id`, `publicCode`（如 `TA-7K3Q9P`）, `accessToken`（随机 32 字节，用于买家查看订单）
- 关联：`listingId`, `merchantId`, `pickupPointId?`
- 买家信息：`buyerName`, `buyerEmail`, `buyerPhone`, `buyerNote?`, `displayAnonymous` (bool)
- `formAnswers` (json)：`scope=order` 的报名字段答案，属于 PII，任何公开接口都不能返回
- `isFree` (bool)：下单时根据接龙的 `pricing` 写入，作为快照
- `onePerEmail` (bool)：下单时复制接龙的 `onePerEmail`，作为快照；部分唯一索引需要它（索引条件不能引用 listing 表）
- `idempotencyKey?` (unique)：客户端生成的 UUID，防止重复提交
- `status`：`PENDING_PAYMENT | PAID | CONFIRMED | FULFILLED | EXPIRED | CANCELLED | REFUNDED | PARTIALLY_REFUNDED | NO_SHOW`，状态流转见第 6 节
- 金额：`subtotalCents`, `platformFeeCents`, `totalCents`, `refundedCents`
- `sequenceNo?`（付款成功后才分配，对应「#12」）
- Stripe 关联：`stripeCheckoutSessionId?`, `stripePaymentIntentId?`
- 时间：`reservationExpiresAt`, `paidAt?`, `fulfilledAt?`, `cancelledAt?`, `reminderSentAt?`, `createdAt`

**OrderItem**
- `id`, `orderId`, `optionId`, `quantity`, `unitPriceCents`, `attendeeName?`（课程类订单填写学员姓名）, `attendeeAnswers` (json，`scope=attendee` 的字段答案)

**Refund**
- `id`, `orderId`, `amountCents`, `reason?`, `stripeRefundId`, `status`, `createdAt`

**ListingCancellation**（商家或 admin 取消整条接龙时创建）
- `id`, `listingId`, `initiatedByUserId`, `reason`, `refundAll` (bool)
- `status`：`PENDING | RUNNING | COMPLETED | COMPLETED_WITH_FAILURES`
- `totalOrders`, `succeeded`, `failed`, `startedAt?`, `finishedAt?`

**RefundTask**
- `id`, `cancellationId`, `orderId`, `amountCents`
- `status`：`PENDING | SUCCEEDED | FAILED`
- `attempts`, `lastError?`, `stripeRefundId?`, `updatedAt`

**NotificationOutbox**
- `id`, `type`（如 `ORDER_CONFIRMED`、`ORDER_REFUNDED`、`EVENT_REMINDER`）, `recipient`, `locale`
- `payload` (json)：渲染模板所需的全部数据，不在发送时再查数据库
- `status`：`PENDING | SENT | FAILED`
- `attempts`, `nextAttemptAt`, `lastError?`, `sentAt?`, `createdAt`
- `dedupeKey` (unique)：如 `ORDER_CONFIRMED:{orderId}`，保证同一通知只入队一次

**StripeEvent**
- `id`（即 Stripe 的 `evt_...`，作为主键）, `type`, `account?`, `receivedAt`, `processedAt?`

**AuditLog**
- `id`, `actorUserId`, `actorRole`
- `action`：例如 `MERCHANT_SUSPEND`、`LISTING_TAKEDOWN`、`PII_REVEAL`、`REFUND_CREATE`
- `targetType`, `targetId`, `reason?`, `metadata` (json), `ip`, `createdAt`
- 只允许追加，不能修改或删除

**Merchant 补充字段**：`suspendedReason?`, `suspendedAt?`

**MerchantNote**（admin 内部备注，`POST /admin/merchants/:id/notes`，仅管理员可见，只追加）
- `id`, `merchantId`, `authorUserId`, `note`, `createdAt`
**Listing 补充字段**：`takenDownReason?`, `takenDownAt?`（被下架的接龙状态为 `CANCELLED`，公开页显示「已下架」）

## 5b. 接龙状态机与发布后的修改规则

```
DRAFT ──(发布)──▶ PUBLISHED ──(手动关闭 / 到达 closesAt)──▶ CLOSED
                     ▲                                        │
                     └──────────(重新开放，可改 closesAt)──────┘
PUBLISHED / CLOSED ──(商家取消 / admin 下架)──▶ CANCELLED（终态）
```

- 所有状态变更只能经过 `ListingStateMachine.transition()`。
- **发布前检查**（D11/D12）：商家未停用；PAID 需 `chargesEnabled`；在售规格价格合规（FREE 全为 0，PAID 为 $1–$20,000）；至少一个在售规格；标题和退款政策非空；`closesAt` 若设置须在未来；PICKUP 至少一个取货点；SESSION / EVENT 每个在售规格都要有开始时间。缺项以 `VALIDATION_FAILED` 的 `details` 列出。
- **创建时的默认值**：FREE 为 `onePerEmail` / `allowSelfCancel` 开、`maxQtyPerOrder=1`（上限 10）；PAID 为关、`maxQtyPerOrder=10`（上限 50）；SESSION / EVENT 的 `remindBeforeHours=24`；发布时若允许自助取消且未设截止时间，取最早场次开始前 2 小时。
- **自动关闭**：`listing-close.job.ts` 每分钟扫描 `PUBLISHED` 且 `closesAt <= now` 的接龙，置为 `CLOSED`。公开页同时做前端倒计时，但以后端状态为准。
- **CLOSED → PUBLISHED**：允许重新开放（`reopen` 只接受 CLOSED，草稿必须走 `publish`），商家可以顺便修改 `closesAt`；重新开放时再跑一遍发布前检查（商家可能已被停用或 Stripe 收款被关闭）；已有订单和序号不受影响。
- **并发**：同一条接龙的所有修改（编辑、规格/取货点替换、发布、截止、重开、自动截止任务）都在事务里锁住该行串行执行，并在锁住的快照上校验。编辑请求必须带上读到的 `revision`，服务端每次修改都让它加一；过期的请求返回 `LISTING_STALE`，避免两个页面互相覆盖（例如一边新增的规格被另一边的替换请求删掉）。
- **CANCELLED** 是终态：取消会触发批量退款（PAID）或批量取消报名（FREE），见第 8.5 节；下架后的恢复（admin `restore`）只允许在没有执行退款或取消的情况下，恢复后状态为 `CLOSED`。
- 取消或下架时，所有 `PENDING_PAYMENT` 订单立即 `EXPIRED`，并让对应的 Checkout 失效。

**发布后哪些字段能改：**

| 字段 | 发布后 | 说明 |
|---|---|---|
| `title`, `description`, `images`, `policyText` | 可改 | 已付订单保留下单时的快照（`OrderItem.unitPriceCents` 等），不受影响 |
| `closesAt` | 可改 | 可以延长或提前；提前到过去的时间等同于关闭 |
| `pricing`, `type`, `fulfilment` | **不可改** | 会改变订单模型 |
| option `priceCents` | 可改 | **只影响新订单**，已有订单按快照价格；改价会记录到 AuditLog（`LISTING_OPTION_PRICE_CHANGE`，含原价和新价） |
| option `capacity` | 可改 | 不能低于 `soldCount + reservedCount`，否则返回 `CAPACITY_BELOW_SOLD` |
| option 删除 | **不可删** | 只能 `active=false`；无任何订单的 option 可以真正删除 |
| 新增 option | 可以 | |
| `totalCapacity` | 可改 | 同样不能低于已售加预占的总数 |
| `formFields` | 有订单后只能新增非必填字段 | 否则已有订单的答案会缺字段 |
| `pickupPoints` | 可增，有订单引用的不能删（`PICKUP_POINT_HAS_ORDERS`，由 `RESTRICT` 外键保证，无竞态） | 修改地址时为每个使用该取货点的订单写入一条 `PICKUP_POINT_CHANGED` 通知（Outbox，按订单 + 新地址去重） |

## 6. 订单状态机

付费订单：
```
PENDING_PAYMENT ──(checkout.session.completed)──▶ PAID ──(商家核销)──▶ FULFILLED
      │                                            │                    │
      ├──(超时 / checkout.session.expired)──▶ EXPIRED │                    │
      └──(买家取消)──▶ CANCELLED                    ├──(全额退款)──▶ REFUNDED ◀─┘
                                                   └──(部分退款)──▶ PARTIALLY_REFUNDED
```

免费订单：
```
（提交）──▶ CONFIRMED ──(商家签到)──▶ FULFILLED
               │
               ├──(买家自助取消 / 商家取消)──▶ CANCELLED
               └──(活动结束后商家标记未到)──▶ NO_SHOW
```

- 免费订单在一个事务里直接创建为 `CONFIRMED`：
  - `soldCount += q`
  - `sequenceNo = ++listing.paidSeq`
  - 不经过 reserved 预占，也不会过期
- 免费订单变为 `CANCELLED` 时，执行 `soldCount -= q`，**释放名额**。接龙序号不回收，报名单上该行不再显示。
- `NO_SHOW` 只是记录，不改变库存；Phase 2 会用它计算爽约率，作为将来限制报名的依据。
- 付费订单永远不会进入 `CONFIRMED`，免费订单永远不会进入 `PAID` 或 `REFUNDED`。状态机按 `isFree` 校验，违反即抛异常。
- 所有状态变更**只能**经过 `OrderStateMachine.transition()`，非法的状态转换直接抛异常。
- 订单变为 `PAID` 时，在同一个事务里完成三件事：
  - `reservedCount -= q`
  - `soldCount += q`
  - `sequenceNo = ++listing.paidSeq`
- 订单变为 `EXPIRED` 或 `CANCELLED` 时，执行 `reservedCount -= q`。
- 退款不会释放库存（货可能已经备好）。商家可以手动调整容量。

## 7. 库存预占与防超卖（核心）

1. 买家提交订单后，在一个事务里对每个 option 执行：
   ```sql
   UPDATE listing_option
   SET reserved_count = reserved_count + :q
   WHERE id = :id AND active
     AND (capacity IS NULL OR sold_count + reserved_count + :q <= capacity)
   RETURNING id;
   ```
   如果影响行数为 0，整个事务回滚，返回 `409 SOLD_OUT`。
   如果接龙设置了 `totalCapacity`，再对 listing 执行同样形式的条件 UPDATE（`reserved_count + :sumQ`），任一失败都回滚。
2. 创建 Order（状态 `PENDING_PAYMENT`），设置 `reservationExpiresAt = now + 30min`。
   - **幂等**：公开下单接口要求 `Idempotency-Key` 请求头（前端生成 UUID，表单打开时生成一次，提交失败重试时沿用）。同一个 key 在 24 小时内重复提交，直接返回第一次的结果（`checkoutUrl` 或 `publicCode`），不再创建订单。实现方式：`Order.idempotencyKey` 唯一索引，捕获唯一冲突后查询原订单返回。
   - 一个接龙里同一邮箱只能有一个未支付的 `PENDING_PAYMENT` 订单；再次提交时让旧订单过期并释放库存，再创建新订单。
3. 在商家的 connected account 上创建 Checkout Session，并设置 `expires_at` 与 `reservationExpiresAt` 一致（Stripe 要求最短 30 分钟）。
4. 由一个定时任务（`@nestjs/schedule`，每分钟运行）扫描已超时的 `PENDING_PAYMENT` 订单：
   - 调用 `checkout.sessions.expire` 让对应的 Checkout 失效
   - 将订单置为 `EXPIRED`，并释放预占的库存
5. **边界情况**：如果订单已经是 `EXPIRED`，却又收到了 `checkout.session.completed`（买家在过期前一刻付款），就尝试重新预占库存：
   - 预占成功：订单转为 `PAID`
   - 预占失败：自动全额退款，并给买家发邮件说明
6. **免费报名**：同样使用第 1 步的条件 UPDATE，只是改为直接对 `sold_count` 加 q（不经过 reserved），然后在同一事务中创建 `CONFIRMED` 订单并分配序号。
   - 如果 `onePerEmail=true`，用部分唯一索引来保证：`UNIQUE (listing_id, lower(buyer_email)) WHERE one_per_email AND status IN ('CONFIRMED','FULFILLED')`。`one_per_email` 是订单上的快照字段；不带这个条件的话，`onePerEmail=false` 的接龙也会被拦住。
   - 冲突时返回 `409 ALREADY_REGISTERED`，并重新给该邮箱发送一次原报名的确认邮件（但**不在接口响应里透露**该邮箱已报名的任何信息）。
7. 必须有一个并发测试：capacity=5，同时发起 50 个下单请求，最终售出数量必须恰好等于 5。

## 8. Stripe 集成

### 8.1 商家入驻
1. `POST /merchants/me/stripe/onboard` 执行以下操作：
   - 如果商家还没有 Stripe 账户，就调用 `accounts.create` 创建一个，参数为 country `NZ`，以及 controller 配置 `stripe_dashboard.type=full`, `fees.payer=account`, `losses.payments=stripe`, `requirement_collection=stripe`；使用 Stripe idempotency key `connect-account:{merchantId}`，重试不会建出第二个账户
   - 然后调用 `accountLinks.create` 生成入驻链接，并返回该 URL
2. 前端跳转到 Stripe 完成入驻，完成后回到 `/dashboard/onboarding/return`（链接失效时 Stripe 跳到 `/dashboard/onboarding?expired=1`，重新生成）。返回页调用 `GET /merchants/me/stripe/status`，它会**实时读取 Stripe 账户并同步**，不必等 webhook。
3. 收到 `account.updated` webhook 后，同步 `chargesEnabled`、`payoutsEnabled`、`detailsSubmitted` 三个字段；商家 `status` 不受影响（创建即 `ACTIVE`，只表示是否被平台停用）；能否收款只看 `chargesEnabled`。
4. 发布 PAID 接龙要求商家 `status=ACTIVE` 且 `chargesEnabled=true`；发布 FREE 接龙只要求 `status=ACTIVE`。

### 8.2 收款
- 使用 `checkout.sessions.create`，并传入 `{ stripeAccount: merchant.stripeAccountId }`（即 direct charge）。
- 参数要点：
  - `mode=payment`, `currency=nzd`
  - `line_items` 由**服务端**根据数据库中的价格构造，绝不信任客户端传来的价格
  - `payment_intent_data.application_fee_amount = platformFeeCents`
  - `metadata.orderId`
  - `customer_email`
  - `expires_at`
  - `success_url = {APP_URL}/o/{publicCode}?t={accessToken}&paid=1`
  - `cancel_url = {APP_URL}/l/{shortCode}`
- 平台费计算：`platformFeeCents = round(subtotal * PLATFORM_FEE_BPS / 10000)`（可再加一个固定费用，均可配置）。
- **金额下限**：Stripe 对 NZD 有最低收款金额，PAID 接龙的 option 最低价定为 $1.00，并在发布时校验。

### 8.3 Webhooks
- 设置两个 endpoint，并分别使用各自的签名密钥：
  - `/webhooks/stripe/connect`：接收 connected account 产生的事件
  - `/webhooks/stripe/platform`：接收平台自身的事件
- NestJS 需要开启 `rawBody: true`，用于签名验证。
- 处理流程：
  1. 验证签名
  2. `INSERT ... ON CONFLICT DO NOTHING` 写入 StripeEvent 表；**只有 `processedAt` 已有值时**才视为重复事件、直接返回 200。（如果按「行已存在就跳过」，第一次处理抛错返回 500 的事件在 Stripe 重试时会被跳过而丢失；所以处理失败时 `processedAt` 保持为空，重试会再次处理，处理逻辑必须幂等。）
  3. 处理业务逻辑
  4. 写入 `processedAt`
- 处理的事件：
  - `checkout.session.completed`：订单转为 PAID，并把 `ORDER_CONFIRMED` 写入 NotificationOutbox（**不直接发邮件**，见第 12 节）
  - `checkout.session.expired`：订单转为 EXPIRED
  - `charge.refunded`：同步退款状态（用于商家在 Stripe Dashboard 里直接退款的情况）
  - `charge.dispute.created`：记录日志并邮件通知商家
  - `account.updated`：同步商家的 Stripe 状态
- 业务处理必须幂等，并能容忍事件乱序到达。`account.updated` 与 `GET …/stripe/status` 共用的同步逻辑按账户加 Postgres advisory 锁（跨实例），持锁读取 Stripe 并写库，避免慢请求用旧结果覆盖新结果。
- Stripe SDK 抛出的错误统一转为 `502 STRIPE_ERROR`（`details.stripeCode`），不把 Stripe 的原始消息返回给前端。

### 8.4 退款
- 调用 `refunds.create({ payment_intent, amount }, { stripeAccount })`，默认设置 `refund_application_fee: true`（平台费退还比例可配置）。
- 退款金额累加不能超过 `totalCents`。

### 8.5 整条接龙取消与批量退款
1. 商家（或 admin）发起取消：创建 `ListingCancellation`，接龙立即置为 `CANCELLED`，公开页显示「已取消」，所有 `PENDING_PAYMENT` 订单过期。
2. 在同一事务里为每笔 `PAID` / `PARTIALLY_REFUNDED` 订单创建一条 `RefundTask`（金额为剩余可退金额）；免费接龙则直接把 `CONFIRMED` 订单置为 `CANCELLED`，不需要任务。
3. `refund.job.ts` 每 30 秒取一批 `PENDING` 任务（`FOR UPDATE SKIP LOCKED`，每批 20 笔），逐笔调用 Stripe：
   - 成功：订单转为 `REFUNDED`，写入 `ORDER_REFUNDED` 通知
   - 失败：`attempts += 1`，指数退避，最多 5 次；超过后标记 `FAILED`
   - 用 `RefundTask.id` 作为 Stripe 的 idempotency key，避免重复退款
4. 全部处理完后更新 `ListingCancellation.status`；有失败时通知商家，并在 admin 后台显示失败列表，支持手动重试。
5. 商家后台的取消弹窗必须显示：订单数、退款总额、「Stripe 手续费不退还」的提示，并要求输入接龙标题确认。
6. `GET /merchants/me/listings/:id/cancellation` 返回进度，前端轮询展示。

## 9. API（REST，前缀 `/api/v1`）

**认证：商家（Clerk）**
- 登录和注册完全由 Clerk 的前端组件完成。后端**没有**商家登录、注册、刷新接口。
- **登录方式**：开启邮箱验证码 + Google 登录。免费档最多可开 3 个社交登录，可以再加 Apple，方便 iPhone 用户。
- **后端验证**：
  - 每个需要商家身份的请求，都由 `ClerkAuthGuard` 验证 Clerk 的会话 JWT
  - 用 `@clerk/backend` 的 `verifyToken`，配置 `CLERK_JWT_KEY` 公钥做本地验证，不需要每次请求 Clerk 的服务器
  - 同时校验 `authorizedParties`（即 `azp` 字段，限定为主站域名和 admin 域名，配置项 `CLERK_AUTHORIZED_PARTIES` 用逗号分隔）
- **JWT 来源**：
  - 前端经由 Next.js rewrites 与后端同源，所以 Clerk 的 `__session` cookie 会自动带到 `/api`，后端优先读取这个 cookie
  - 同时也支持 `Authorization: Bearer <token>`，为将来的原生 App 预留
- **用户同步**（双保险，两条路径都必须幂等）：
  1. Clerk webhook：`POST /webhooks/clerk`，用 Svix 签名校验，处理 `user.created`、`user.updated`、`user.deleted`，按 `clerkUserId` upsert User
  2. 即时创建：Guard 验证 JWT 后，如果数据库里还没有这个 `clerkUserId`，就当场创建 User（role=MERCHANT），避免 webhook 延迟导致第一次请求失败
  - 当 `user.deleted` 时，软删除 User，并停用其商家（订单数据保留）。若删除事件早于创建事件到达，写入一条已删除的「墓碑」User（只有 `clerkUserId`），迟到的 `user.created` 不会让它复活
- `GET /me`：返回当前商家用户、角色，以及是否已有商家资料

**角色区分（Clerk 内部）**
- 新用户首次登录时，后端将其创建为 `MERCHANT`（通过 webhook 或即时创建），并通过 Clerk Backend API 把 `publicMetadata.role` 设为 `merchant`
- **管理员不能自助注册**。提升权限只能通过后端 CLI：`pnpm --filter backend admin:grant <email>` 和 `admin:revoke <email>`
  - CLI 在**同一个事务**里更新数据库中的 role 并写入 AuditLog，提交后再同步 Clerk 的 `publicMetadata.role`；同步失败时额外记录 `ADMIN_ROLE_CLERK_SYNC_FAILED` 审计、命令以非零码退出，重跑同一命令只会重试同步
  - 只有在环境变量 `ADMIN_EMAIL_ALLOWLIST` 中的邮箱才能被提升为管理员
- **在 Clerk Dashboard 中自定义 session token**，加入 `"metadata": "{{user.public_metadata}}"`，这样前端 middleware 可以直接从 JWT 读到角色，不需要额外请求
- **两层授权**：
  - 前端只用 JWT 里的 role 做路由跳转和隐藏菜单，**不作为安全依据**
  - 后端每个 admin 接口都在 `ClerkAuthGuard` 之后再经过 `RolesGuard('ADMIN')`，从**数据库**读取最新角色。这样撤销管理员权限后，后端立即生效，不用等 JWT 过期
- **绝不使用 `unsafeMetadata` 存放角色**：这个字段用户自己可以在前端修改。`publicMetadata` 只有后端能写入

**商家 (Merchant)，需登录**
- `POST /merchants`（创建商家资料）
- `GET /merchants/me`
- `PATCH /merchants/me`
- `POST /merchants/me/stripe/onboard` → {url}
- `GET /merchants/me/stripe/status`：实时读取 Stripe 账户并同步后，返回商家资料（与 `GET /merchants/me` 同一结构，含 `stripeConnected`、`chargesEnabled` 等）
- ~~`POST /merchants/me/stripe/dashboard-link`~~（M2 删除）：full-dashboard 账户没有 login link（见第 4 节注），链接永远是 `https://dashboard.stripe.com/`，由前端直接给出，不需要接口

**接龙 (Listings)，商家**
- `GET /merchants/me/listings`
- `POST /merchants/me/listings`
- `GET|PATCH /merchants/me/listings/:id`
- `POST /merchants/me/listings/:id/publish`
- `POST /merchants/me/listings/:id/close`
- `POST /merchants/me/listings/:id/reopen` {closesAt?}：CLOSED → PUBLISHED
- `POST /merchants/me/listings/:id/cancel` {reason}：触发第 8.5 节的流程，返回 `cancellationId`
- `GET /merchants/me/listings/:id/cancellation`：批量退款进度
- `PATCH /merchants/me/listings/:id` 对发布后的接龙按第 5b 节的规则校验，违规时返回 `FIELD_LOCKED_AFTER_PUBLISH` 或 `CAPACITY_BELOW_SOLD`
- `PUT /merchants/me/listings/:id/options`
- `PUT /merchants/me/listings/:id/pickup-points`

**订单 (Orders)，商家**
- `GET /merchants/me/listings/:id/orders?status=&q=`
- `GET /merchants/me/listings/:id/orders.csv`
- `POST /merchants/me/orders/:id/fulfil`
- `POST /merchants/me/orders/:id/refund` {amountCents, reason}

**上传 (Uploads)**
- `POST /uploads/presign` {contentType, contentLength} → {uploadUrl, publicUrl}（S3 / R2 预签名 **PUT**，限 jpeg / png / webp，最大 5MB）。R2 不支持带 POST policy 的表单上传，所以把 `Content-Length` 一起签进 URL：实际上传大小与声明不符时签名失效，以此在服务端强制 5MB 上限。对象键为 `listings/{merchantId}/{uuid}.{ext}`；接龙的 `images` 只接受本商家通过该接口拿到的 URL（最多 9 张）：解析并规范化后须与存储同源、不带查询串，路径恰好是 `listings/{merchantId}/{uuid}.{jpg|png|webp}`，`../` 之类无法绕过

**公开接口 (Public)，无需登录**
- `GET /public/listings/:shortCode`：返回接龙详情、各 option 的剩余数量、商家公开信息
- `GET /public/listings/:shortCode/participants?cursor=`：返回 `[{seq, displayName, summary, paidAt}]`，其中姓名已脱敏
- `POST /public/listings/:shortCode/orders`：提交 {items[{optionId, qty, attendeeName?}], buyer{name, email, phone}, pickupPointId?, note?, anonymous}，返回以下二者之一：
  - 付费接龙：`{ kind: 'checkout', checkoutUrl }`
  - 免费接龙：`{ kind: 'confirmed', publicCode, accessToken }`
  - 请求体中额外包含 `formAnswers`、`items[].attendeeAnswers`、`turnstileToken`
  - 服务端会按接龙的 `formFields` 校验答案：必填项、类型、选项是否合法
- `GET /public/orders/:publicCode?t=token`：返回订单状态；`PENDING_PAYMENT` 且带有 `stripeCheckoutSessionId` 时，前端据此显示「正在确认付款」
- `POST /public/orders/recover` {email, turnstileToken}：**找回订单**。把该邮箱最近 90 天内所有有效订单（PAID / CONFIRMED / FULFILLED）的链接汇总成一封邮件发送；无论邮箱是否存在，接口都返回相同的成功响应；限流为同一邮箱每小时 3 次
- **Origin 校验（CSRF 补充防线，全局 `OriginGuard`）**：所有公开写接口，以及所有带 cookie 的写请求（POST/PUT/PATCH/DELETE），`Origin` 请求头都必须是我们自己的域名（`APP_URL` 和 `CLERK_AUTHORIZED_PARTIES`），否则返回 403。Clerk 的 `__session` 是 SameSite=Lax，但 admin 子域名与主站同站，所以仍需这道检查；不带 cookie 的调用（webhook、Bearer 客户端）不受影响
- `POST /public/orders/:publicCode/cancel?t=token`
  - 付费订单：仅限 `PENDING_PAYMENT` 状态
  - 免费订单：`CONFIRMED` 状态，且 `allowSelfCancel` 为 true、当前时间早于 `selfCancelUntil`
- `POST /merchants/me/orders/:id/cancel` {reason}：商家取消免费报名，并通知买家
- `POST /merchants/me/orders/:id/no-show`：商家标记免费报名为未到
- `GET /public/merchants/:slug`

**Admin（需要 role=ADMIN；所有写操作都要求填写 `reason`，并写入 AuditLog）**
- `GET /admin/stats`：今日新商家数、GMV（7 天 / 30 天）、待处理争议数
- `GET /admin/merchants?status=&risk=&q=&cursor=`
- `GET /admin/merchants/:id`：商家详情、Stripe 状态、接龙列表、订单汇总、退款率、争议数
- `POST /admin/merchants/:id/suspend` {reason}：停用商家，其进行中的接龙全部不可下单
- `POST /admin/merchants/:id/reinstate` {reason}
- `POST /admin/merchants/:id/notes` {note}：内部备注，仅管理员可见
- `GET /admin/listings?merchantId=&status=&pricing=&q=&cursor=`：浏览所有商家发起的接龙
- `GET /admin/listings/:id`：接龙详情，包括 options、报名或订单汇总、商家信息
- `POST /admin/listings/:id/close` {reason}：提前截止，已有订单保留
- `POST /admin/listings/:id/takedown` {reason, refundAll: bool}：下架，公开页显示「已下架」；可以选择一并全额退款（付费接龙）或取消所有报名（免费接龙）
- `POST /admin/listings/:id/restore` {reason}：恢复被下架的接龙，仅限下架时没有执行退款或取消的情况
- **admin 不能修改商家接龙的内容**（标题、价格、描述）。内容有问题时，只能下架并联系商家修改，以免平台对商家内容承担编辑责任
- `GET /admin/orders?q=`：可按 publicCode、邮箱、手机号查询，返回的 PII 默认遮罩
- `POST /admin/orders/:id/reveal-pii`：返回明文 PII，并记录 `PII_REVEAL`
- `POST /admin/orders/:id/refund` {amountCents, reason}：代商家退款（例如处理投诉时）。使用 direct charge 时，平台可以在商家的 connected account 上直接发起退款；必须记入审计日志，并邮件通知商家
- `GET /admin/disputes?status=`
- `GET /admin/audit-log?actor=&action=&targetId=&cursor=`
- `GET /admin/cancellations?status=`、`POST /admin/refund-tasks/:id/retry`：批量退款的失败处理
- `POST /admin/buyers/anonymize` {email, reason}：**隐私删除请求**。把该邮箱所有订单的 `buyerName`、`buyerEmail`、`buyerPhone`、`buyerNote`、`formAnswers`、`attendeeName`、`attendeeAnswers` 替换为占位值，`accessToken` 作废；保留金额和状态用于对账；写入 AuditLog（`BUYER_ANONYMIZE`）。只有 `PENDING_PAYMENT` 和有未结争议的订单不能匿名化

**风险标记**（MVP 阶段在服务端实时计算，无需规则引擎）：满足以下任一条件即标记，在列表中显示 ⚠
- 商家创建不到 7 天
- 退款率超过 10%
- 存在未结的争议
- 单日 GMV 超过该商家过去 30 天日均值的 5 倍

**Webhooks**
- `POST /webhooks/stripe/connect`
- `POST /webhooks/stripe/platform`
- `POST /webhooks/clerk`：Clerk 用户同步，用 Svix 签名校验

**错误格式**：统一为 `{ code, message, details? }`。错误码目录见第 17 节，前端的 i18n 映射只能使用目录里的码。

## 10. 隐私与安全

- **姓名脱敏**：「Arthur Gao」显示为「Arthur G.」；中文姓名「高阳」显示为「高*」；买家勾选匿名时显示「匿名」。邮箱和手机号绝不出现在任何公开接口中。
- **订单访问**：买家通过 `accessToken` 查看订单。比较 token 时使用常量时间比较；token 只放在链接和邮件中，不写入日志。
- **限流**：
  - 登录相关的限流和暴力破解防护由 Clerk 负责
  - 公开下单：同一 IP 每分钟最多 10 次
- **防刷（主要针对免费报名）**：免费报名没有付款这道门槛，很容易被脚本刷满或被恶意占位，因此：
  - 所有公开下单接口都要求通过 **Cloudflare Turnstile** 人机验证，后端校验 token
  - 免费接龙默认开启 `onePerEmail`
  - `maxQtyPerOrder` 对免费接龙默认为 1，最高可设为 10
  - Phase 2 视情况增加邮箱确认链接后才生效的报名模式
- **自定义字段**：
  - 商家后台在添加字段时提示「只收集活动必需的信息，不要收集证件号、银行卡号等敏感信息」
  - 字段的 label 做关键词检查，命中 passport、IRD、bank、卡号、护照 等词时给出警告
- **校验**：所有输入都用 class-validator 校验；价格只取自数据库。
- **统一身份、分角色授权**：
  - 商家和管理员使用同一个 Clerk 应用和同一种会话；`/api/v1/admin/*` 一律要求数据库中的角色为 ADMIN
  - 公开的买家页面不加载 Clerk
- **admin 账号安全**（免费档没有 MFA，因此需要以下补偿措施）：
  - 管理员使用独立的公司邮箱，不与商家账号混用；只有在白名单中的邮箱才能被提升为管理员
  - **建议管理员只用 Google 登录**，并在 Google Workspace 层面强制开启两步验证，借用 Google 的 MFA
  - 处理 Clerk 的 `session.created` webhook：如果登录的是管理员，就写入 AuditLog（`ADMIN_SIGN_IN`），并给所有管理员发送邮件通知
  - **上线前（接入真实资金之前）必须升级 Clerk Pro**，对 admin 强制开启 MFA，并缩短会话有效期
- **独立域名**：admin 使用独立域名 `admin.tagalong.nz`，与主站指向同一个 Next.js 应用，由 middleware 按 host 分流：
  - admin 域名：路径 `/x` 内部 rewrite 到 `/{locale}/admin/x`；非 admin 的路径一律返回 404
  - 主域名：访问 `/admin/*` 一律返回 404
  - 本地开发时用 `admin.localhost:3800`
  - Phase 2 如需 IP 白名单或 SSO，在这一层（middleware 或 Vercel Firewall）实现
- **商家停用**：商家被置为 SUSPENDED 后，其名下所有接龙不能再下单，公开页显示「暂停销售」。
- **Privacy Act 2020**：
  - 需要隐私政策页面，并且只收集履约必需的数据
  - **访问与删除请求**：买家可以邮件联系平台，admin 用「买家匿名化」工具处理（第 9 节）；商家可以通过导出 CSV 获取自己的数据，删除账号时由 `user.deleted` 流程处理。隐私政策要写明处理时限（Privacy Act 要求 20 个工作日内回应）
  - **数据保留**：订单的 PII 在接龙结束 12 个月后由定时任务自动匿名化（金额和状态保留）；AuditLog 保留 7 年
  - 商家的账号数据（邮箱、姓名）存放在 Clerk，Clerk 的服务器在境外，属于跨境披露（IPP 12）。隐私政策中必须写明，商家注册页也要提示
  - 买家数据不经过 Clerk
- **平台条款**：要求商家声明自己的经营合规（例如销售食品需要按 Food Act 注册），并禁止酒类、处方药、武器等商品。

## 11. 前端页面

**公开页面（移动端优先，SSR）**
- `/` 首页，介绍平台并引导商家注册
- `/l/[shortCode]` 接龙页，包含：
  - 图片轮播、标题、商家信息、截止倒计时
  - option 选择和数量选择
  - 取货点选择
  - 买家信息表单与自定义报名字段 → 付费接龙跳转 Stripe 付款；免费接龙直接提交，进入订单页显示「报名成功」
  - 已接龙列表
  - 剩余数量，每 15 秒轮询刷新
  - 使用 `next/og` 动态生成 OG 图片
- `/o/[publicCode]?t=` 订单状态页：
  - 从 Stripe 回跳时（带 `paid=1`）而订单仍是 `PENDING_PAYMENT`，显示「正在确认付款…」并每 2 秒轮询，最多 60 秒；超时后显示「付款已提交，确认后会发邮件通知」，**不显示**「未付款」
  - 付款成功：确认提示、取货信息、加入日历、取消报名（免费）
- `/find-order` 找回订单页：输入邮箱，提示「如果该邮箱有订单，我们会把链接发过去」；接龙页和确认邮件的页脚都链接到这里
- **微信内置浏览器**：检测到 WeChat UA 时，在页面顶部显示常驻横幅「微信内无法使用 Apple Pay，建议点右上角在浏览器中打开」；Android 微信提供「复制链接」按钮
- **搜索引擎**：接龙页和商家主页默认输出 `<meta name="robots" content="noindex">`，仅当 `listing.indexable=true` 时去掉；首页和法律页面正常收录
- `/m/[slug]` 商家公开主页，展示进行中的接龙
- `/legal/terms`、`/legal/privacy`

**商家登录与后台（merchant 风格）**
- `/login`：商家登录页，使用 merchant 风格，内嵌 Clerk 的 `<SignIn />` 组件：
  - 通过 Clerk 的 `appearance` 参数改用 merchant 风格的变量（颜色、字体、圆角），中文界面用 `@clerk/localizations` 的 zhCN
  - 页面左侧（桌面端）或顶部（手机端）放一段简短的平台介绍
- `/sign-up` 使用 `<SignUp />` 组件，风格与登录页一致
- 登录完成后进入 `/dashboard`；如果还没有商家资料，先进入创建引导
- 免费档的 Clerk 组件会显示「Secured by Clerk」字样，可以接受；升级 Pro 后可去掉
- 公开首页 `/` 上的「商家登录」按钮链接到这里。
- `/dashboard`：概览，以及待办事项（如未完成 Stripe 入驻）
- `/dashboard/onboarding`、`/dashboard/onboarding/return`
- `/dashboard/listings`、`/new`、`/[id]/edit`：编辑器分步骤进行：类型 → 内容 → 规格/场次 → 取货/地点 → 政策 → 预览发布。时间输入一律按新西兰本地时间理解：夏令时开始时不存在的时间直接拒绝，结束时重复的一小时取较早的时刻，未改动的时间原样保留
- `/dashboard/listings/[id]/orders`：订单列表，支持搜索、按状态筛选、一键核销、退款弹窗、导出 CSV、复制分享文案
- `/dashboard/settings`：商家资料、Stripe Dashboard 链接（固定为 `https://dashboard.stripe.com/`）

**Admin 后台（admin 风格，通过 `admin.tagalong.nz` 访问；桌面优先）**
- `/admin/login`：管理员登录页，使用 Clerk 的 `<SignIn />` 组件，套用 admin 的暗色风格（`appearance` 参数）。
  - **隐藏「注册」入口**：通过 `appearance.elements.footerAction` 隐藏底部的注册链接
  - 页面极简，没有营销内容；任何公开页面都不链接到这里
- 路由结构上，`admin/(auth)/login` 不需要登录；`admin/(console)/*` 共用一个 layout：
  - 未登录：跳转到 `/admin/login`
  - 已登录但不是管理员（JWT 中的 role 不是 admin）：返回 404
  - 真正的权限判断在后端，前端的检查只用于页面跳转
- `/admin`：概览，显示 4 个关键数字和「待处理」列表（风险商家、未结争议）
- `/admin/merchants`：商家表格，点击行打开右侧抽屉查看详情，可停用 / 恢复、添加内部备注，并能跳转到该商家的所有接龙
- `/admin/listings`：所有商家的接龙表格，可按商家、状态、付费/免费筛选；详情抽屉中可提前截止、下架（可选全部退款或取消报名）、恢复下架
- `/admin/orders`：订单查询，PII 默认遮罩
- `/admin/disputes`：争议列表
- `/admin/audit-log`：审计日志
- 页面顶部始终显示环境横幅：生产环境为红色，staging 为琥珀色。admin 的 layout 在服务端校验角色，非管理员访问时返回 404。

**视觉风格**：三个区域各有独立风格，详见 `docs/UI-STYLE.md`。
- public：集市报名单
- merchant：摊主账本
- admin：控制室（只做暗色）

**免费报名在界面上的差异**：
- 公开页：
  - 价格位置显示「免费」
  - 主按钮文字为「报名」（付费为「接龙」）
  - 报名单标题为「已报名」
  - 订单页提供「取消报名」按钮，并显示自助取消的截止时间
- 商家后台：
  - 订单页标题改为「报名名单」
  - 核销按钮改为「签到」
  - 活动结束后可以批量标记未到
  - 导出 CSV 时包含所有自定义字段答案
- 接龙编辑器：第一步先选「付费 / 免费」，免费接龙会跳过 Stripe 入驻的检查

**分享文案生成**：一键复制一段适合发到群里的文字，例如：
```
【接龙】车厘子 2kg $39 | 周六 Albany 自提
已接龙 23 人，剩 7 份 👉 https://tagalong.nz/l/abc12345
```

## 12. 通知

- **Outbox 机制（D16）**：业务代码只调用 `notifications.enqueue(type, recipient, payload, dedupeKey)`，在业务事务内写入 `NotificationOutbox`。`outbox.job.ts` 每 10 秒取一批 `PENDING` 记录（`FOR UPDATE SKIP LOCKED`）发送：成功写 `sentAt`，失败则 `attempts += 1` 并按 1、5、30 分钟、2 小时、12 小时退避，5 次后标记 `FAILED` 并上报 Sentry。`dedupeKey` 保证重复的 webhook 不会发两封邮件。
- 使用 `EmailService` 抽象层：开发环境用 Mailpit，生产环境用 Resend 或 AWS SES。
- 邮件模板使用 React Email 或 MJML，支持中英双语。
- 需要发送的邮件：
  - 买家：付款确认、退款通知、订单被自动退款（超时边界情况）
  - 免费报名：报名成功确认（附取消链接和 .ics 文件）、商家取消报名的通知
  - 活动提醒：SESSION / EVENT 类订单在开始前 `remindBeforeHours` 小时发送（付费和免费都发），由 `reminder.job.ts` 每 15 分钟扫描一次，`Order.reminderSentAt` 用来保证幂等
  - 买家：找回订单的链接汇总邮件；取货点变更通知；接龙被取消的通知
  - 商家：入驻完成、出现争议、批量退款完成（含失败数）、每日订单汇总（Phase 2）
  - 确认邮件和收据中带上商家的 GST 号（如有）。税务发票由商家自行负责，平台不开具

## 13. 非功能需求

- 目标规模：MVP 支持 1000 个商家、单个接龙峰值每分钟 200 单。
- 部署：
  - 前端部署在 Vercel，绑定两个域名：`tagalong.nz`（主站）和 `admin.tagalong.nz`（admin），对应同一个项目
  - 后端使用 Docker 部署在 Render / Railway / AWS ECS，选择离新西兰最近的区域（ap-southeast-2）
  - 数据库使用托管 Postgres（Neon / RDS）
  - 文件存储使用 S3 或 Cloudflare R2
- **环境清单**：

| | local | staging | production |
|---|---|---|---|
| 主站域名 | localhost:3800 | staging.tagalong.nz | tagalong.nz |
| admin 域名 | admin.localhost:3800 | admin-staging.tagalong.nz | admin.tagalong.nz |
| 后端 | localhost:3810 | api-staging.tagalong.nz | api.tagalong.nz |
| Clerk | Development 实例 | Development 实例（第二个） | Production 实例 |
| Stripe | test mode + Stripe CLI 转发 | test mode + 固定 webhook | live mode |
| 数据库 | docker compose | 托管 Postgres（独立实例） | 托管 Postgres（PITR 开启） |
| 邮件 | Mailpit | Resend 测试域名 | Resend 正式域名 |
| Turnstile | 测试 site key（总是通过） | 正式 | 正式 |

  - 本地端口刻意避开默认值（同一台开发机上 3000 / 4000 / 5432 / 8025 已被其他项目占用）：前端 3800（Playwright e2e 用 3801）、后端 3810、Postgres 5442、Mailpit UI 8026 / SMTP 1026。
  - Clerk 的 Development 实例不支持自定义域名，staging 的 admin 子域名共享会话需要实际验证；如果不行，staging 可以先把 admin 路径放在主域名下。
- **备份与恢复**：生产数据库开启 PITR（至少 7 天），每周做一次恢复演练；S3 / R2 开启版本控制；Clerk 用户数据每月导出一次存档。
- 可观测性：结构化日志（pino），每个请求带 requestId；Sentry 接入前后端。
- 测试：
  - 后端：服务层用 Vitest 单元测试（NestJS 12 只发布 ESM 包，Jest 无法加载，Nest 官方 ESM 模板默认即 Vitest + SWC）；e2e 测试用 Testcontainers Postgres；Stripe 调用通过注入的 `StripeClient` 进行 mock；必须包含第 7 节的超卖并发测试
  - 前端：组件测试；用 Playwright 覆盖「打开接龙页 → 下单 → 返回成功页」的主流程（Stripe 部分 mock）
- CI：GitHub Actions 依次运行 lint、typecheck、test、build。

## 14. 里程碑（按顺序交给 Claude Code 实现）

| M | 内容 | 完成标准 |
|---|---|---|
| M0 | 项目脚手架：pnpm workspace、backend（NestJS + Prisma）、frontend（Next.js + Tailwind + shadcn/ui，并按 UI-STYLE.md 搭好三个 surface 的变量和字体骨架）、docker-compose（postgres、mailpit）、ESLint/Prettier、CI | `pnpm dev` 能把两个应用都跑起来，`/api/v1/health` 返回 ok |
| M1 | Prisma schema 与 migration（第 5 节）；接入 Clerk；**验证 Clerk 会话在 admin 子域名上的共享（第 13 节风险点），不通过就先改用主域名下的 `/admin` 路径**（前端组件和 middleware、后端 `ClerkAuthGuard` + `RolesGuard`、用户同步 webhook 和即时创建、`publicMetadata.role` 同步、`admin:grant` / `admin:revoke` CLI）；商家资料 | e2e 测试使用 mock 的 Clerk token 验证器：首次请求自动创建 User → 创建商家资料；webhook 签名错误时拒绝；重复的 webhook 只产生一次效果 |
| M2 | Stripe Connect 入驻与 `account.updated` webhook | test mode 下完整走通入驻流程，`chargesEnabled` 变为 true |
| M3 | 接龙 CRUD、options、取货点、图片上传；接龙状态机（第 5b 节）、自动关闭任务、发布后修改规则、重新开放、`totalCapacity`、`indexable` | 商家可以完整发布一个接龙；修改规则的单元测试全部通过；到 `closesAt` 后 1 分钟内自动关闭 |
| M4 | 公开接龙页、OG 图片、参与者列表（脱敏） | 链接分享到 WhatsApp 能显示预览卡片 |
| M5 | 下单流程、库存预占（含 `totalCapacity`）、`Idempotency-Key`、Checkout、webhooks、过期扫描、边界情况自动退款、NotificationOutbox + outbox job、订单页「正在确认付款」轮询 | 并发测试通过；同一 key 重复提交只产生一个订单；邮件服务宕机时付款确认不丢失；完整走通 test mode 付款 |
| M5b | 免费报名：直接确认、onePerEmail、自助取消、商家取消和标记未到、自定义报名字段（付费接龙同样可用）、Turnstile | 未完成 Stripe 入驻的商家也能发布免费接龙并完成报名、取消、签到全流程；免费报名的并发测试通过 |
| M6 | 商家订单管理：列表、CSV 导出、核销、退款；整条接龙取消与批量退款任务（第 8.5 节） | 部分退款与全额退款都正确；50 笔订单的取消在 Stripe mock 部分失败时能正确重试并报告 |
| M7 | 邮件模板、.ics 日历、活动提醒、找回订单、微信横幅、noindex、i18n 双语、分享文案 | 中英文切换完整；找回订单对不存在的邮箱返回相同响应 |
| M8 | Admin 后台：Clerk 登录页（暗色风格、无注册入口）、API（商家管理、接龙管理、代退款、批量退款失败处理、买家匿名化）、风险标记、AuditLog、各页面 | 停用商家后，其接龙页立即显示「暂停销售」；所有 admin 写操作都有审计记录 |
| M9 | staging 与生产部署、PITR、Sentry、法律页面、生产环境 Stripe / Clerk webhook 配置、PII 保留期匿名化任务 | 线上环境可用；恢复演练完成一次 |

## 15. Phase 2 待设计

- 成团门槛：使用 SetupIntent 先保存卡，成团后 off-session 扣款，扣款失败时通知买家
- 配送（DELIVERY）：配送费、配送范围、地址校验
- 商家多人协作（店员账号，Clerk Organizations）
- 隐私友好的访问统计（如 Plausible），给商家看浏览量和转化率
- 周期课和学期套餐、候补名单、请假补课
- 买家账号与历史订单
- 评价与举报、商家信誉分
- 优惠码
- 「线下转账 + 商家手动确认」付款选项
- SSE 实时更新剩余数量
- 原生 App（Expo / React Native，复用 OpenAPI client）
- Admin 风控规则引擎、管理员 2FA、admin 拆分为独立域名或应用（如有需要）

## 16. 待确认问题

1. 平台费率和收费模式：按百分比抽成、固定费用，还是商家订阅制？
2. 品牌名 TagAlong 的 .nz 域名和商标是否可用？
3. 是否需要平台控制商家打款节奏？如果需要，D2 要改为 Express + destination charges，平台承担更多风险。
4. 第一批种子商家是华人社区团购，还是课程老师？这会决定 M3/M4 先打磨哪种类型。
5. 免费接龙不产生平台收入。是否需要限制，例如免费接龙每月的报名人数上限，或者推出商家订阅制？
6. Clerk Pro 的升级时间点：建议在接入真实资金之前升级，对 admin 开启 MFA。
7. 用户条款、商家协议和隐私政策需要律师起草。平台定位是 marketplace，不是卖家；商家协议要包含合规声明、禁售品类、退款责任归属、平台下架权。
8. **admin 子域名共享 Clerk 会话尚未实测**（M1 先用 mock 完成；拿到 Clerk Development 应用的 key 后验证，不通过则改用主域名下的 `/admin` 路径，见第 13 节）。

**已拍板的产品规则（写进 FAQ）**
- 买家修改数量：只能取消后重新下单。付费订单由商家做部分退款。
- Stripe 手续费在退款时不退还，由商家承担。
- 接龙序号一旦分配不回收，取消的订单只是从报名单上隐藏。

## 17. 错误码目录

前端 `lib/api/errors.ts` 和 `messages/*.json` 只能使用这里的码，新增错误码必须先加到这里。

| code | HTTP | 场景 |
|---|---|---|
| `VALIDATION_FAILED` | 400 | 请求体校验失败，`details` 为字段错误 |
| `TURNSTILE_FAILED` | 400 | 人机验证未通过 |
| `BAD_REQUEST` | 4xx（保留框架原状态码） | 框架层拒绝、且上面没有专门错误码的客户端错误，如 413 请求体过大、415 不支持的 Content-Type、405 方法不允许 |
| `UNAUTHENTICATED` | 401 | 无有效会话 |
| `FORBIDDEN` | 403 | 角色不符或不是资源所有者 |
| `NOT_FOUND` | 404 | 资源不存在，或 token 不匹配（订单页统一返回 404，不区分） |
| `LISTING_NOT_PUBLISHED` | 409 | 接龙不在 PUBLISHED 状态 |
| `LISTING_CLOSED` | 409 | 已截止或已取消 |
| `MERCHANT_SUSPENDED` | 409 | 商家已停用 |
| `MERCHANT_PROFILE_EXISTS` | 409 | 该账号已经创建过商家资料 |
| `SLUG_TAKEN` | 409 | 商家 slug 已被占用 |
| `MERCHANT_NOT_CHARGEABLE` | 409 | 发布付费接龙但未完成 Stripe 入驻 |
| `SOLD_OUT` | 409 | 库存或名额不足 |
| `ALREADY_REGISTERED` | 409 | onePerEmail 冲突 |
| `QTY_EXCEEDS_LIMIT` | 409 | 超过 maxQtyPerOrder |
| `INVALID_STATE_TRANSITION` | 409 | 订单或接龙状态机拒绝 |
| `FIELD_LOCKED_AFTER_PUBLISH` | 409 | 修改了发布后锁定的字段 |
| `CAPACITY_BELOW_SOLD` | 409 | 容量改到低于已售 |
| `OPTION_HAS_ORDERS` | 409 | 删除有订单的 option |
| `PICKUP_POINT_HAS_ORDERS` | 409 | 删除有订单引用的取货点 |
| `LISTING_STALE` | 409 | 接龙已被其他请求修改（提交的 `revision` 已过期），需刷新后重试 |
| `SELF_CANCEL_WINDOW_PASSED` | 409 | 超过自助取消时间 |
| `REFUND_EXCEEDS_TOTAL` | 409 | 退款超过可退金额 |
| `PRICE_OUT_OF_RANGE` | 422 | 价格低于 $1 或超过上限 |
| `RATE_LIMITED` | 429 | 限流 |
| `STRIPE_ERROR` | 502 | Stripe 调用失败，`details.stripeCode` |
| `INTERNAL` | 500 | 未分类错误，不暴露细节 |
