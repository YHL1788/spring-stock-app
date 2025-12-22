// 移除 date-fns 依赖，改用原生 Date 处理

// --- 日期工具函数 ---

// 解析日期并归一化到本地午夜 00:00:00，避免时间差异
function parseISO(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

// 归一化日期对象到午夜
function normalizeDate(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

// 计算两个日期之间的天数差 (严格匹配 Python 的 .days 逻辑)
function differenceInDays(dateLeft: Date, dateRight: Date): number {
  // 确保使用 UTC 时间戳计算以避免夏令时干扰，或者直接用归一化后的午夜时间
  const d1 = normalizeDate(dateLeft);
  const d2 = normalizeDate(dateRight);
  const diffTime = d1.getTime() - d2.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24)); 
}

function formatDate(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// --- 数学工具函数 ---

// 简单的线性同余发生器 (LCG) 用于模拟随机种子 (匹配 Python 的确定性)
class SeededRNG {
    private seed: number;
    constructor(seed: number) {
        this.seed = seed;
    }
    // 生成 [0, 1) 之间的随机数
    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}

// 生成标准正态分布随机数 (Box-Muller Transform)
function randomStandardNormal(rng: SeededRNG): number {
  let u = 0, v = 0;
  while (u === 0) u = rng.next();
  while (v === 0) v = rng.next();
  return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

// Cholesky 分解 (带容错重试，严格匹配 Python 逻辑)
function choleskyDecomposition(matrix: number[][]): number[][] {
  try {
      return computeCholesky(matrix);
  } catch (e) {
      // Python: epsilon = 1e-5
      const epsilon = 1e-5;
      const perturbedMatrix = matrix.map((row, i) => 
          row.map((val, j) => (i === j ? val + epsilon : val))
      );
      return computeCholesky(perturbedMatrix);
  }
}

function computeCholesky(matrix: number[][]): number[][] {
    const n = matrix.length;
    const lower = new Array(n).fill(0).map(() => new Array(n).fill(0));

    for (let i = 0; i < n; i++) {
        for (let j = 0; j <= i; j++) {
            let sum = 0;
            if (j === i) {
                for (let k = 0; k < j; k++) sum += Math.pow(lower[j][k], 2);
                const val = matrix[j][j] - sum;
                if (val < 0) throw new Error("Matrix not positive definite");
                lower[j][j] = Math.sqrt(val);
            } else {
                for (let k = 0; k < j; k++) sum += lower[i][k] * lower[j][k];
                lower[i][j] = (matrix[i][j] - sum) / lower[j][j];
            }
        }
    }
    return lower;
}

// --- 类型定义 ---

export interface FCNParams {
  product_name?: string;
  broker_name?: string;
  total_notional: number;
  denomination: number;
  tickers: string[];
  ticker_name?: string[];
  initial_spots: number[];
  current_spots?: number[]; 
  
  // --- 历史数据配置 ---
  history_start_date?: string; 
  hist_prices?: { [ticker: string]: { date: string, close: number }[] }; 
  
  // --- 分红数据 ---
  discrete_dividends?: { [ticker: string]: [string, number][] };

  trade_date: string;
  obs_dates: string[];
  pay_dates: string[];
  strike_pct: number;
  trigger_pct: number;
  coupon_rate: number;
  coupon_freq?: number;
  risk_free_rate: number;
  n_sims: number;
  vols?: number[];         
  corr_matrix?: number[][]; 
  market?: string; 
  fx_rate?: number; 
  seed?: number; // 随机种子，选填
}

export interface CouponPeriod {
  obs_date: Date;
  payment_date: Date;
  full_coupon: number;
  start_date: Date;
  days: number;
  idx: number;
}

export interface FCNResult {
  status: 'Active' | 'KnockedOut' | 'Expired';
  dirty_price: number;
  clean_price: number;
  hist_coupons_paid: number;
  pending_coupons_pv: number;
  future_coupons_pv: number;
  principal_pv: number;
  implied_loss_pv: number;
  early_redemption_prob: number;
  autocall_prob: number;
  loss_prob: number;
  loss_attribution: number[];
  autocall_attribution: number[];
  exposure_value_avg: number[];
  exposure_shares_avg: number[];
  settlement_info?: any;
  product_name_display?: string;
  market?: string;
  fx_rate?: number;
  avg_period_coupon: number; // 新增：用于计算预期期数
}

// --- 定价器类 ---

export class FCNPricer {
  params: FCNParams;
  S0: number[];
  S_curr: number[];
  K_pct: number;
  Trigger_pct: number;
  c_rate: number;
  r: number;
  sigma: number[];
  denom: number;
  trade_date: Date;
  obs_dates: Date[];
  payment_dates: Date[];
  val_date: Date; 
  coupon_schedule: CouponPeriod[];
  L: number[][]; 
  dividends: { [ticker: string]: { date: Date, amount: number }[] }; 
  rng: SeededRNG;

  constructor(params: FCNParams, val_date_str?: string) {
    this.params = params;
    // 如果没有提供 seed，使用当前时间戳作为随机种子
    this.rng = new SeededRNG(params.seed !== undefined && !isNaN(params.seed) ? params.seed : Date.now());

    this.S0 = params.initial_spots;
    this.S_curr = params.current_spots && params.current_spots.length > 0 
      ? params.current_spots 
      : [...params.initial_spots];

    this.K_pct = params.strike_pct;
    this.Trigger_pct = params.trigger_pct;
    this.c_rate = params.coupon_rate;
    this.r = params.risk_free_rate;
    this.denom = params.denomination;

    this.sigma = params.vols || new Array(this.S0.length).fill(0.30); 
    
    let corr = params.corr_matrix;
    if (!corr) {
      const n = this.S0.length;
      corr = new Array(n).fill(0).map((_, i) => 
        new Array(n).fill(0).map((_, j) => (i === j ? 1.0 : 0.5))
      );
    }
    this.L = choleskyDecomposition(corr);

    this.trade_date = parseISO(params.trade_date);
    // 强制 val_date 为午夜，与 Python 的 datetime.strptime 对齐
    this.val_date = val_date_str ? parseISO(val_date_str) : normalizeDate(new Date()); 
    
    this.obs_dates = params.obs_dates.map(d => parseISO(d));
    this.payment_dates = params.pay_dates.map(d => parseISO(d));

    this.dividends = {};
    if (params.discrete_dividends) {
        for (const [ticker, divList] of Object.entries(params.discrete_dividends)) {
            this.dividends[ticker] = divList.map(([dStr, amt]) => ({
                date: parseISO(dStr as string),
                amount: Number(amt)
            }));
        }
    }

    this.coupon_schedule = [];
    let prev_date = this.trade_date;
    const coupon_freq = params.coupon_freq || 12;

    this.obs_dates.forEach((obs_d, i) => {
      const pay_d = this.payment_dates[i];
      const days_in_period = differenceInDays(obs_d, prev_date);
      
      let full_coupon_amt = 0;
      if (coupon_freq) {
        // Mode A: Rate / Freq
        full_coupon_amt = this.denom * this.c_rate / coupon_freq;
      } else {
        // Mode B: Act/365
        full_coupon_amt = this.denom * this.c_rate * (days_in_period / 365.25);
      }

      this.coupon_schedule.push({
        obs_date: obs_d,
        payment_date: pay_d,
        full_coupon: full_coupon_amt,
        start_date: prev_date,
        days: days_in_period,
        idx: i
      });
      prev_date = obs_d;
    });
  }

  get_historical_price(dateObj: Date, tickerIdx: number): number | null {
      if (!this.params.hist_prices) return null;
      
      const ticker = this.params.tickers[tickerIdx];
      const prices = this.params.hist_prices[ticker];
      if (!prices || prices.length === 0) return null;

      const targetStr = formatDate(dateObj);
      
      const exact = prices.find(p => p.date === targetStr);
      if (exact) return exact.close;

      for (let i = 1; i <= 5; i++) {
          const prevDate = new Date(dateObj);
          prevDate.setDate(dateObj.getDate() - i);
          const prevStr = formatDate(prevDate);
          const found = prices.find(p => p.date === prevStr);
          if (found) return found.close;
      }
      return null;
  }

  check_lifecycle_status(): { status: 'Active' | 'KnockedOut' | 'Expired', msg: string, item?: CouponPeriod } {
    const last_payment = this.coupon_schedule[this.coupon_schedule.length - 1].payment_date;
    if (this.val_date > last_payment) {
      return { status: 'Expired', msg: '已自然到期 (Maturity Reached)' };
    }

    if (this.params.hist_prices) {
        const past_obs = this.coupon_schedule.filter(item => item.obs_date <= this.val_date);
        
        for (const item of past_obs) {
            let is_triggered = true;
            for (let i = 0; i < this.S0.length; i++) {
                const hist_p = this.get_historical_price(item.obs_date, i);
                const trigger_price = this.S0[i] * this.Trigger_pct;
                if (hist_p === null || hist_p < trigger_price) {
                    is_triggered = false;
                    break;
                }
            }
            if (is_triggered) {
                return { 
                    status: 'KnockedOut', 
                    msg: `于 ${formatDate(item.obs_date)} 触发提前敲出`,
                    item: item 
                };
            }
        }
    }
    return { status: 'Active', msg: '存续中' };
  }

  // 计算应计利息 (Accrued Interest)
  calculate_accrued_interest(): { amount: number, days: number } {
      if (this.val_date < this.trade_date) {
          return { amount: 0.0, days: 0 };
      }
      
      // 找到当前所在的 coupon period
      // Python 逻辑: period["start_date"] <= self.val_date < period["obs_date"]
      let current_period: CouponPeriod | null = null;
      for (const period of this.coupon_schedule) {
          if (period.start_date <= this.val_date && this.val_date < period.obs_date) {
              current_period = period;
              break;
          }
      }

      if (current_period) {
          const accrued_days = differenceInDays(this.val_date, current_period.start_date);
          const fraction = current_period.days > 0 ? accrued_days / current_period.days : 0;
          const accrued_interest = current_period.full_coupon * fraction;
          return { amount: accrued_interest, days: accrued_days };
      }
      
      return { amount: 0.0, days: 0 };
  }

  calculate_coupons_status(autocall_item?: CouponPeriod) {
    let realized = 0.0;
    let pending = 0.0;
    
    const cutoff_date = autocall_item ? autocall_item.obs_date : this.obs_dates[this.obs_dates.length - 1];

    for (const period of this.coupon_schedule) {
      if (period.obs_date > cutoff_date) continue;

      if (period.payment_date <= this.val_date) {
        realized += period.full_coupon;
      } else if (period.obs_date <= this.val_date && this.val_date < period.payment_date) {
        pending += period.full_coupon;
      }
    }
    return { realized, pending };
  }

  simulate_price(): FCNResult {
    const statusObj = this.check_lifecycle_status();
    const { realized, pending } = this.calculate_coupons_status(statusObj.item);
    const avg_period_coupon = this.coupon_schedule.length > 0 ? this.coupon_schedule[0].full_coupon : 1.0;
    
    // 如果非存续，返回快照
    if (statusObj.status !== 'Active') {
        let p_pv = 0;
        let c_pv = 0; 
        
        if (statusObj.status === 'KnockedOut' && statusObj.item) {
             if (this.val_date < statusObj.item.payment_date) {
                 p_pv = this.denom;
             }
        }
        
        // 结束状态 dirty = pending (如有) + principal
        return {
            status: statusObj.status,
            dirty_price: p_pv + pending, 
            clean_price: 0,
            hist_coupons_paid: realized,
            pending_coupons_pv: pending,
            future_coupons_pv: 0,
            principal_pv: p_pv,
            implied_loss_pv: 0,
            early_redemption_prob: 0, autocall_prob: 0, loss_prob: 0,
            loss_attribution: [], autocall_attribution: [],
            exposure_value_avg: [], exposure_shares_avg: [],
            settlement_info: { desc: statusObj.msg, type: statusObj.status },
            product_name_display: this.params.product_name,
            market: this.params.market,
            fx_rate: this.params.fx_rate,
            avg_period_coupon // 返回单期票息用于计算预期期数
        };
    }

    // 计算应计利息 (仅 Active 时)
    const { amount: accrued_int } = this.calculate_accrued_interest();

    // 确定未来观察日
    const future_obs_indices = this.obs_dates
      .map((d, i) => ({ date: d, idx: i }))
      .filter(item => item.date > this.val_date)
      .map(item => item.idx);
    
    const T_obs = future_obs_indices.map(idx => differenceInDays(this.obs_dates[idx], this.val_date) / 365.25);

    if (T_obs.length === 0) {
        // Active 但无未来观察点 (Waiting for payment)
        const dirty = this.denom + pending;
        return {
            status: 'Active',
            dirty_price: dirty, 
            clean_price: dirty - accrued_int - pending,
            hist_coupons_paid: realized, pending_coupons_pv: pending,
            future_coupons_pv: 0, principal_pv: this.denom, implied_loss_pv: 0,
            early_redemption_prob: 0, autocall_prob: 0, loss_prob: 0,
            loss_attribution: [], autocall_attribution: [],
            exposure_value_avg: [], exposure_shares_avg: [],
            product_name_display: this.params.product_name,
            market: this.params.market,
            fx_rate: this.params.fx_rate,
            avg_period_coupon
        };
    }

    const n_sims = this.params.n_sims || 10000;
    const n_assets = this.S0.length;
    const n_steps = T_obs.length;
    
    let total_future_coupon_pv = 0;
    let total_principal_pv = 0;
    let autocall_count = 0;
    let loss_count = 0;
    const loss_attribution = new Array(n_assets).fill(0);
    const exposure_value_sum = new Array(n_assets).fill(0);
    const exposure_shares_sum = new Array(n_assets).fill(0);
    const autocall_per_period = new Array(n_steps).fill(0);

    // 预处理分红
    const future_dividends_map: { [step_idx: number]: { [asset_idx: number]: number } } = {};
    if (this.params.discrete_dividends) {
        let prev_sim_date = this.val_date;
        future_obs_indices.forEach((real_obs_idx, t_idx) => {
            const obs_date = this.obs_dates[real_obs_idx];
            this.params.tickers.forEach((ticker, asset_idx) => {
                const divList = this.dividends[ticker];
                if (!divList) return;
                let amount_sum = 0.0;
                for (const div of divList) {
                    if (div.date > prev_sim_date && div.date <= obs_date) {
                        amount_sum += div.amount;
                    }
                }
                if (amount_sum > 0) {
                    if (!future_dividends_map[t_idx]) future_dividends_map[t_idx] = {};
                    future_dividends_map[t_idx][asset_idx] = amount_sum;
                }
            });
            prev_sim_date = obs_date;
        });
    }

    // 蒙特卡洛循环
    for (let sim = 0; sim < n_sims; sim++) {
        let terminated = false;
        let path_c_pv = 0;
        let path_p_pv = 0;

        // 生成随机数 Z_uncorr (n_assets x n_steps)
        const Z_uncorr = new Array(n_assets).fill(0).map(() => new Array(n_steps).fill(0).map(() => randomStandardNormal(this.rng)));
        
        // 应用相关性
        const Z_corr_T = new Array(n_steps).fill(0).map((_, t) => {
           const Z_t_uncorr = Z_uncorr.map(row => row[t]); 
           return this.L.map(row => row.reduce((sum, val, k) => sum + val * Z_t_uncorr[k], 0));
        });

        let current_prices = [...this.S_curr];
        let prev_T = 0;

        for (let t_idx = 0; t_idx < n_steps; t_idx++) {
            const curr_T = T_obs[t_idx];
            const dt = curr_T - prev_T;
            const obs_idx = future_obs_indices[t_idx];
            
            // 欧拉-丸山步进
            current_prices = current_prices.map((S, asset_i) => {
                const drift = (this.r - 0.5 * Math.pow(this.sigma[asset_i], 2)) * dt;
                const diffusion = this.sigma[asset_i] * Math.sqrt(dt) * Z_corr_T[t_idx][asset_i];
                return S * Math.exp(drift + diffusion);
            });
            prev_T = curr_T;

            // 扣除分红
            if (future_dividends_map[t_idx]) {
                for (const [asset_idx_str, amount] of Object.entries(future_dividends_map[t_idx])) {
                    const asset_idx = Number(asset_idx_str);
                    current_prices[asset_idx] = Math.max(current_prices[asset_idx] - amount, 0.01);
                }
            }

            const pct_perf = current_prices.map((p, i) => p / this.S0[i]);
            const is_autocall = pct_perf.every(p => p >= this.Trigger_pct);
            const full_coupon = this.coupon_schedule[obs_idx].full_coupon;

            if (is_autocall && !terminated) {
                path_c_pv += full_coupon; 
                path_p_pv += this.denom;
                terminated = true;
                autocall_count++;
                autocall_per_period[t_idx]++;
                break;
            } else {
                path_c_pv += full_coupon;
            }
        }

        if (!terminated) {
            const pct_perf = current_prices.map((p, i) => p / this.S0[i]);
            let worst_pct = pct_perf[0];
            let worst_idx = 0;
            pct_perf.forEach((p, i) => {
                if (p < worst_pct) {
                    worst_pct = p;
                    worst_idx = i;
                }
            });

            if (worst_pct >= this.K_pct) {
                path_p_pv += this.denom;
            } else {
                const redemption = this.denom * (worst_pct / this.K_pct);
                path_p_pv += redemption;
                loss_count++;
                loss_attribution[worst_idx]++;
                
                const strike_price = this.S0[worst_idx] * this.K_pct;
                const num_shares = this.denom / strike_price;
                exposure_value_sum[worst_idx] += redemption;
                exposure_shares_sum[worst_idx] += num_shares;
            }
        }

        total_future_coupon_pv += path_c_pv;
        total_principal_pv += path_p_pv;
    }

    const avg_future_coupon_pv = total_future_coupon_pv / n_sims;
    const avg_principal_pv = total_principal_pv / n_sims;
    
    // Dirty Price = Future Coupon PV + Principal PV + Pending Coupon
    const avg_dirty_price = avg_future_coupon_pv + avg_principal_pv + pending;
    
    // Clean Price = Dirty Price - Accrued Interest - Pending Coupon
    const avg_clean_price = avg_dirty_price - accrued_int - pending;
    
    let early_redemption_count = 0;
    const last_period_idx = this.obs_dates.length - 1;
    autocall_per_period.forEach((count, i) => {
        if (future_obs_indices[i] < last_period_idx) {
            early_redemption_count += count;
        }
    });

    const period_count = this.obs_dates.length;
    const t_names = this.params.ticker_name ? this.params.ticker_name.join(',') : this.params.tickers.join(',');
    const product_name_display = this.params.product_name || 
        `${this.params.broker_name || 'MS'} / ${formatDate(this.trade_date)} / ${period_count}期 / ${t_names} / ${(this.K_pct*100).toFixed(1)}% / ${(this.c_rate*100).toFixed(2)}% / ${this.params.total_notional} ${this.params.market || 'HKD'}`;

    return {
        status: 'Active',
        dirty_price: avg_dirty_price,
        clean_price: avg_clean_price, 
        hist_coupons_paid: realized,
        pending_coupons_pv: pending,
        future_coupons_pv: avg_future_coupon_pv,
        principal_pv: avg_principal_pv,
        implied_loss_pv: this.denom - avg_principal_pv,
        early_redemption_prob: early_redemption_count / n_sims,
        autocall_prob: autocall_count / n_sims,
        loss_prob: loss_count / n_sims,
        loss_attribution: loss_attribution.map(c => c / n_sims),
        autocall_attribution: autocall_per_period.map(c => c / n_sims),
        exposure_value_avg: exposure_value_sum.map(v => v / n_sims),
        exposure_shares_avg: exposure_shares_sum.map(v => v / n_sims),
        product_name_display,
        market: this.params.market,
        fx_rate: this.params.fx_rate,
        avg_period_coupon
    };
  }
}