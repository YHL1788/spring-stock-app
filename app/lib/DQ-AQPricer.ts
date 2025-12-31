// app/lib/DQ-AQPricer.ts

// ==========================================
// 1. 数据接口定义
// ==========================================

export interface Period {
  period_id: number;
  obs_start: string;
  obs_end: string;
  settle_date: string;
  trading_days: number;
}

export interface BasicInfo {
  contract_type: 'DQ' | 'AQ';
  broker: string;
  account: string;
  executor: string;
  currency: string;
  trade_date: string;
  daily_shares: number;       // 每日股数 (DQ为负)
  max_global_shares: number;  // 最大股数 (DQ为负)
  ki_barrier_pct: number;
  ko_barrier_pct: number;
  leverage: number;
}

export interface UnderlyingInfo {
  ticker: string;
  stock_name: string;
  spot_price: number; // S0
}

export interface SimulationParams {
  sim_fx_rate?: number;       
  history_start_date?: string;
  sim_count: number;
  random_seed: number;
  risk_free_rate: number;     
}

export interface ValuationResult {
  expected_shares: number;
  ko_probability: number;
  val_full_usd: number;
  val_net_usd: number;
  val_full_hkd: number;
  val_net_hkd: number;
  exp_completion_rate: number;
  shares_settled_paid: number;
  shares_locked_unpaid: number;
  shares_future: number;
  status_msg: string;
  final_fx_rate: number;
  final_r: number;
  calc_sigma: number;
  history_records?: any[]; // 历史交易明细
}

// ==========================================
// 2. 数学与辅助函数
// ==========================================

class SeededRNG {
    private seed: number;
    constructor(seed: number) { this.seed = seed; }
    next(): number {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
}

function standardNormal(rng: SeededRNG): number {
    let u = 0, v = 0;
    while (u === 0) u = rng.next();
    while (v === 0) v = rng.next();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

function mean(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function std(arr: number[]): number {
    if (arr.length < 2) return 0;
    const m = mean(arr);
    const variance = arr.reduce((acc, val) => acc + Math.pow(val - m, 2), 0) / (arr.length - 1);
    return Math.sqrt(variance);
}

// 计算年化波动率 (252天)
export function calculateVolatility(prices: number[]): number {
    if (!prices || prices.length < 2) return 0.20; 
    
    const logRets: number[] = [];
    for (let i = 1; i < prices.length; i++) {
        const curr = prices[i];
        const prev = prices[i-1];
        if (typeof curr !== 'number' || typeof prev !== 'number' || curr <= 0 || prev <= 0) continue;
        logRets.push(Math.log(curr / prev));
    }
    
    if (logRets.length < 2) return 0.20;
    return std(logRets) * Math.sqrt(252);
}

// 日期比较工具 (YYYY-MM-DD)
function isDateBefore(d1: string, d2: string): boolean { return d1 < d2; }
function isDateBeforeOrEqual(d1: string, d2: string): boolean { return d1 <= d2; }
function isDateAfterOrEqual(d1: string, d2: string): boolean { return d1 >= d2; }

// ==========================================
// 3. 核心估值类 (DQAQValuator)
// ==========================================

export class DQAQValuator {
    private basic_info: BasicInfo;
    private underlying_info: UnderlyingInfo;
    private sim_params: SimulationParams;
    private periods: Period[];
    private sigma: number;
    
    private s0_trade: number;
    private strike: number;
    private ko_barrier: number;
    private dt: number = 1/252;
    private total_days: number;

    constructor(
        basic: BasicInfo, 
        underlying: UnderlyingInfo, 
        sim: SimulationParams, 
        periods: Period[],
        sigma: number
    ) {
        this.basic_info = basic;
        this.underlying_info = underlying;
        this.sim_params = sim;
        this.periods = periods;
        this.sigma = sigma;

        this.s0_trade = underlying.spot_price;
        this.strike = basic.ki_barrier_pct * this.s0_trade;
        this.ko_barrier = basic.ko_barrier_pct * this.s0_trade;
        
        this.total_days = periods.reduce((sum, p) => sum + p.trading_days, 0);
    }

    private check_ko(current_price: number): boolean {
        if (this.basic_info.contract_type === 'DQ') {
            return current_price <= this.ko_barrier;
        } else {
            return current_price >= this.ko_barrier;
        }
    }

    private calculate_daily_shares(current_price: number): number {
        const { contract_type, daily_shares, leverage } = this.basic_info;
        if (contract_type === 'DQ') {
            // DQ: 价格低于Strike时按1倍累计，否则按杠杆累计
            if (current_price <= this.strike) return daily_shares;
            else return daily_shares * leverage;
        } else {
            // AQ: 价格高于Strike时按1倍累计，否则按杠杆累计
            if (current_price >= this.strike) return daily_shares;
            else return daily_shares * leverage;
        }
    }

    // 单条路径估值逻辑
    private evaluate_path(full_price_path: number[], return_details: boolean = false): any {
        let accumulated_shares = 0.0;
        let is_knocked_out = false;
        let ko_day_idx = -1;
        const transaction_records: any[] = [];
        
        let current_day_idx = 1; // 索引0是S0

        for (const period of this.periods) {
            let period_shares = 0.0;
            let period_ko = false;

            if (is_knocked_out) {
                if (return_details) {
                    transaction_records.push({
                        period_id: period.period_id,
                        settle_date: period.settle_date,
                        shares: 0.0,
                        status: "Skipped (KO)"
                    });
                }
                continue;
            }

            for (let day = 0; day < period.trading_days; day++) {
                if (current_day_idx >= full_price_path.length) break;
                
                const price = full_price_path[current_day_idx];

                // A. 检查敲出
                if (this.check_ko(price)) {
                    is_knocked_out = true;
                    period_ko = true;
                    ko_day_idx = current_day_idx;
                    break;
                }

                // B. 计算当日股数
                let daily = this.calculate_daily_shares(price);

                // C. 检查最大股数限制
                let hit_cap = false;
                const max_g = this.basic_info.max_global_shares;
                
                if (max_g < 0) { // DQ
                    if (accumulated_shares + daily < max_g) {
                        daily = max_g - accumulated_shares;
                        hit_cap = true;
                    }
                } else { // AQ
                    if (accumulated_shares + daily > max_g) {
                        daily = max_g - accumulated_shares;
                        hit_cap = true;
                    }
                }

                accumulated_shares += daily;
                period_shares += daily;
                current_day_idx++;

                if (hit_cap) break;
                if (max_g < 0) { if (accumulated_shares <= max_g) break; }
                else { if (accumulated_shares >= max_g) break; }
            }

            if (return_details) {
                let is_full = false;
                const max_g = this.basic_info.max_global_shares;
                if (max_g < 0) is_full = accumulated_shares <= max_g;
                else is_full = accumulated_shares >= max_g;

                const is_partial = current_day_idx >= full_price_path.length && !is_knocked_out && !is_full;
                
                let status = "Settled";
                if (period_ko) status = "Knocked Out";
                else if (is_partial) status = "Accruing (Partial)";

                transaction_records.push({
                    period_id: period.period_id,
                    settle_date: period.settle_date,
                    shares: period_shares,
                    status: status
                });
            }
        }

        if (return_details) return { final_shares: accumulated_shares, is_knocked_out, ko_day_idx, transaction_records };
        return { final_shares: accumulated_shares, is_knocked_out, ko_day_idx };
    }

    // 生成估值报告
    public generate_report(
        current_mkt_p: number, 
        history_prices: number[], 
        history_dates: string[], 
        valuation_date_str: string,
        final_fx_rate: number
    ): ValuationResult {
        
        const contract_start = this.periods[0].obs_start;
        const contract_end = this.periods[this.periods.length - 1].obs_end;
        const trade_dt = this.basic_info.trade_date;

        let status_msg = "";
        let history_segment: number[] = [];
        let is_historically_ko = false;
        let is_expired_mode = false;
        let accumulated_hist_shares = 0.0;
        let history_records: any[] = [];

        // 1. 确定状态并过滤历史数据
        if (isDateBefore(valuation_date_str, trade_dt)) {
            status_msg = "尚未订约 (Pre-start)";
        } else if (isDateBefore(valuation_date_str, contract_start)) {
            status_msg = "订约但未开始 (Signed, Not Started)";
        } else if (isDateBefore(valuation_date_str, contract_end)) {
            status_msg = "存续中 (Mid-life)";
            
            // 过滤出合约期内的历史数据
            const filtered_history: number[] = [];
            for(let i=0; i<history_prices.length; i++) {
                if (isDateAfterOrEqual(history_dates[i], contract_start)) {
                    filtered_history.push(history_prices[i]);
                }
            }
            history_segment = filtered_history;

            if (history_segment.length > 0) {
                const check_path = [this.s0_trade, ...history_segment];
                const res = this.evaluate_path(check_path, true);
                accumulated_hist_shares = res.final_shares;
                is_historically_ko = res.is_knocked_out;
                history_records = res.transaction_records;
            }
        } else {
            status_msg = "已到期/结束 (Closed/Expired)";
            is_expired_mode = true;
            
            const filtered_history: number[] = [];
            for(let i=0; i<history_prices.length; i++) {
                if (isDateAfterOrEqual(history_dates[i], contract_start) && isDateBeforeOrEqual(history_dates[i], contract_end)) {
                    filtered_history.push(history_prices[i]);
                }
            }
            history_segment = filtered_history;

            if (history_segment.length > 0) {
                const check_path = [this.s0_trade, ...history_segment];
                const res = this.evaluate_path(check_path, true);
                accumulated_hist_shares = res.final_shares;
                is_historically_ko = res.is_knocked_out;
                history_records = res.transaction_records;
            }
        }

        if (is_historically_ko) status_msg = "已结束，提前敲出";

        // 2. 计算已结算与未付股份
        let shares_settled_paid = 0.0;
        let shares_locked_unpaid = 0.0;

        for (const rec of history_records) {
            let is_paid = false;
            // 结算日小于等于估值日视为已付
            if (rec.status !== 'Skipped (KO)' && isDateBeforeOrEqual(rec.settle_date, valuation_date_str)) {
                is_paid = true;
            }
            if (is_paid) shares_settled_paid += rec.shares;
            else shares_locked_unpaid += rec.shares;
        }

        // 3. 蒙特卡洛模拟
        let total_exp_shares = accumulated_hist_shares;
        let ko_count = is_historically_ko ? this.sim_params.sim_count : 0;

        if (!is_historically_ko && !is_expired_mode) {
            const past_len = history_segment.length;
            const remaining_days = this.total_days - past_len;

            if (remaining_days > 0) {
                const rng = new SeededRNG(this.sim_params.random_seed);
                const shares_results: number[] = [];
                let sim_ko_c = 0;
                
                // 起点：最新历史价或当前市价
                const start_p = history_segment.length > 0 ? history_segment[history_segment.length - 1] : current_mkt_p;
                const r = this.sim_params.risk_free_rate;
                const sigma = this.sigma;

                const check_path_prefix = [this.s0_trade, ...history_segment];

                for (let i = 0; i < this.sim_params.sim_count; i++) {
                    const future_path: number[] = [];
                    let p = start_p;
                    
                    for (let t = 0; t < remaining_days; t++) {
                        const z = standardNormal(rng);
                        const drift = (r - 0.5 * sigma * sigma) * this.dt;
                        const diffusion = sigma * Math.sqrt(this.dt) * z;
                        p = p * Math.exp(drift + diffusion);
                        future_path.push(p);
                    }

                    // 拼接完整路径
                    const full_sim_path = [...check_path_prefix, ...future_path];
                    const res = this.evaluate_path(full_sim_path, false);
                    shares_results.push(res.final_shares);
                    if (res.is_knocked_out) sim_ko_c++;
                }
                total_exp_shares = mean(shares_results);
                ko_count = sim_ko_c;
            }
        }

        // 4. 计算最终价值
        const net_price_shares = total_exp_shares - shares_settled_paid;
        const spread = current_mkt_p - this.strike;
        
        const val_full_usd = total_exp_shares * spread;
        const val_net_usd = net_price_shares * spread;

        let exp_completion_rate = 0.0;
        const max_g = this.basic_info.max_global_shares;
        if (Math.abs(max_g) > 0) {
            exp_completion_rate = (total_exp_shares * this.basic_info.leverage) / max_g;
        }
        
        const fx = final_fx_rate || 1.0;

        return {
            expected_shares: total_exp_shares,
            ko_probability: ko_count / this.sim_params.sim_count,
            val_full_usd,
            val_net_usd,
            val_full_hkd: val_full_usd * fx,
            val_net_hkd: val_net_usd * fx,
            exp_completion_rate,
            shares_settled_paid,
            shares_locked_unpaid,
            shares_future: net_price_shares - shares_locked_unpaid,
            status_msg,
            final_fx_rate: fx,
            final_r: this.sim_params.risk_free_rate,
            calc_sigma: this.sigma,
            history_records
        };
    }
}