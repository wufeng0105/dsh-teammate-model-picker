/**
 * Teammate model picker — browser half.
 *
 * Registers one ADDITIVE entry into the `conversation.input.right` list slot —
 * the compact-controls seat in the composer's standard tool row, immediately
 * before the model seat the official selector owns. The official
 * `conversation.input.model` slot is a `single` slot whose shipped occupant is
 * the only winner, so a second occupant there would shadow the Lead's own
 * selector globally; `conversation.input.right` is `kind: "list"`,
 * `replaceRisk: "none"`, `occupants: []` — the sanctioned additive seat.
 *
 * The entry renders ONLY for teammate (subagent-addressed, continuable)
 * sessions; ordinary sessions render nothing, so the Lead's composer is
 * visually unchanged.
 *
 * Visual parity: this component mirrors the official
 * `dsh-client-ui-model-selection` ModelSelect — the same two-pane menu
 * (root: "Model"/"Reasoning effort" cells → model pane: search + grouped
 * options + check mark), the same trigger (label + " · effort" + chevron),
 * and the same stylesheet copied verbatim with a `tmp_` class prefix and only
 * `--dsw-alias-*` theme-token references. No Harness Client package is
 * imported: only `react` from the browser module table, and the menu is built
 * from plain DOM instead of the primitives' MenuSurface/MenuGroup.
 *
 * Data sources (all official, nothing imported):
 *   - model catalog: `ctx.remote.session.modelCatalog()` — the same
 *     Host-generation catalog the official selector reads, so group names and
 *     model display names (including quota/price text) are never hardcoded;
 *   - durable per-teammate override: this bundle's `Config.overrides` row,
 *     read and written through the Harness settings Remote
 *     (`ctx.remote.settings.describe()` / `.mutate()`). The write lands in the
 *     profile patch layer, so it survives restarts, and the Host half applies
 *     it when this row's fiber restarts.
 *
 * @module @local/dsh-teammate-model-picker/client
 */
window.__ModuleLoader__.load({
	id: '@local/dsh-teammate-model-picker',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });
		const React = require('react');
		const createPortal = (() => {
			try { return require('react-dom').createPortal; } catch { return null; }
		})();
		const { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } = React;
		const h = React.createElement;

		const NS = 'teammate-model-picker';
		const ROW_ID = 'teammate-model-picker';
		const SLOT = 'conversation.input.right';
		const ENTRY_ID = 'teammate-model-picker';

		/** Unplaced portal card: hidden but laid out at a fixed origin so offsetWidth/offsetHeight are real (same measure pass as the official ModelSelect). */
		const MEASURE_STYLE = { visibility: 'hidden', left: 0, top: 0 };

		const zh = {
			'picker.label': '队友模型',
			'picker.hint': '为这个队友切换模型；不影响主线会话和全局默认模型',
			'picker.override': '（队友）',
			'picker.model': '模型',
			'picker.effort': '推理等级',
			'picker.loading': '正在加载模型…',
			'picker.search': '搜索模型',
			'picker.default': '请选择模型',
			'picker.defaultEffort': 'Default',
			'picker.applying': '正在切换…',
			'picker.error': '切换失败',
			'picker.empty': '没有可用的模型',
			'picker.noResults': '没有匹配的模型',
			'picker.back': '返回',
		};
		const en = {
			'picker.label': 'Teammate model',
			'picker.hint': 'Switch this teammate to another model; the Lead session and the global default model are unchanged',
			'picker.override': '(teammate)',
			'picker.model': 'Model',
			'picker.effort': 'Reasoning effort',
			'picker.loading': 'Loading models…',
			'picker.search': 'Search models',
			'picker.default': 'Select model',
			'picker.defaultEffort': 'Default',
			'picker.applying': 'Switching…',
			'picker.error': 'Switch failed',
			'picker.empty': 'No models available',
			'picker.noResults': 'No matching models',
			'picker.back': 'Back',
		};

		// Copy of the official ModelSelect.module.css, class prefix renamed to
		// `tmp_`; every color/radius/elevation is still a --dsw-alias-* token.
		const css = '.tmp_root{min-width:0;position:relative}.tmp_trigger{border-radius:var(--dsw-radius-sm);min-width:0;max-width:min(360px,45cqw);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:4px;padding:0 4px 0 8px;font-size:13px;font-weight:400;line-height:20px;display:flex}'
			+ '.tmp_trigger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}'
			+ '.tmp_trigger:focus-visible:not([data-selection-focus]){box-shadow:0 0 0 2px var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary))}'
			+ '.tmp_trigger:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}'
			+ '.tmp_triggerLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}'
			+ '.tmp_triggerEffort{text-overflow:ellipsis;white-space:nowrap;min-width:0;color:var(--dsw-alias-label-caption);flex-shrink:1000;overflow:hidden}'
			+ '.tmp_triggerIcon{display:var(--dsh-composer-model-icon-display,none);flex:none}'
			+ '.tmp_triggerLabel,.tmp_triggerEffort{display:var(--dsh-composer-model-text-display,block)}'
			+ '.tmp_chevron{color:var(--dsw-alias-label-caption);flex:none;transition:transform .12s}'
			+ '.tmp_chevronOpen{transform:rotate(180deg)}'
			+ '.tmp_menu{z-index:1100;--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);width:max-content;min-width:min(240px,100vw - 32px);max-width:min(420px,100vw - 32px);max-height:min(360px,100vh - 96px);box-shadow:var(--dsw-elevation-prominent);color:var(--dsw-alias-label-primary);--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);border:0;border-radius:12px;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);flex-direction:column;padding:4px;display:flex;position:fixed;overflow:hidden}'
			+ '.tmp_status,.tmp_empty{color:var(--dsw-alias-label-tertiary);padding:8px;font-size:12px;line-height:18px}'
			+ '.tmp_error,.tmp_warning{border-radius:var(--dsw-radius-md);background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:flex-start;gap:6px;margin-bottom:3px;padding:6px 7px;font-size:11px;line-height:16px;display:flex}'
			+ '.tmp_warning{background:var(--dsw-alias-bg-module-platform);color:var(--dsw-alias-state-warn-label)}'
			+ '.tmp_retry{color:inherit;font:inherit;cursor:pointer;background:0 0;border:none;flex:none;padding:0;font-weight:600}'
			+ '.tmp_searchRow{flex-shrink:0;margin:2px 0 3px;position:relative}'
			+ '.tmp_searchRow .tmp_search{border-radius:var(--dsw-radius-md);background:0 0;border:0 solid #0000;height:auto;padding:5px 7px;display:flex}'
			+ '.tmp_searchRow .tmp_searchWithQuery{padding-right:34px}'
			+ '.tmp_searchClear{width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:50%;justify-content:center;align-items:center;padding:0;display:inline-flex;position:absolute;top:50%;right:4px;transform:translateY(-50%)}'
			+ '.tmp_searchClear:hover,.tmp_searchClear:focus-visible{background:var(--dsw-alias-interactive-bg-hover);outline:none}'
			+ '.tmp_searchRow .tmp_search:focus-within{border-color:#0000}'
			+ '.tmp_searchRow .tmp_search input{padding:0;font-size:12px;line-height:normal;background:0 0;border:0;outline:none;color:inherit;width:100%}'
			+ '.tmp_searchRow .tmp_search input::placeholder{color:var(--dsw-alias-label-caption)}'
			+ '.tmp_groups{min-height:0;overflow-y:auto}'
			+ '.tmp_groupLabel{color:var(--dsw-alias-label-tertiary);padding:8px 8px 4px;font-size:12px;line-height:18px}'
			+ '.tmp_option{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;min-height:34px;color:inherit;text-align:left;cursor:pointer;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:5px 7px;display:flex}'
			+ '.tmp_option:hover:not(:disabled),.tmp_option:focus-visible,.tmp_optionActive:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}'
			+ '.tmp_option:disabled{color:var(--dsw-alias-label-dimmed);cursor:default}'
			+ '.tmp_optionCopy{flex-direction:column;flex:1;min-width:0;display:flex}'
			+ '.tmp_modelName{color:inherit;text-overflow:ellipsis;white-space:nowrap;font-size:13px;font-weight:400;line-height:18px;overflow:hidden}'
			+ '.tmp_check{color:var(--dsw-alias-label-primary);flex:0 0 14px;place-items:center;display:grid}'
			+ '.tmp_check svg{width:14px;height:14px}'
			+ '.tmp_cell{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:auto;min-width:100%;height:34px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;background:0 0;border:none;outline:none;align-items:center;gap:6px;padding:0 8px;font-size:13px;line-height:20px;display:flex}'
			+ '.tmp_cell:hover,.tmp_cell:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}'
			+ '.tmp_cellLabel{white-space:nowrap;flex:none}'
			+ '.tmp_cellValue{text-overflow:ellipsis;white-space:nowrap;text-align:right;min-width:0;color:var(--dsw-alias-label-tertiary);flex:auto;overflow:hidden}'
			+ '.tmp_cellChevron{width:12px;height:12px;color:var(--dsw-alias-menu-icon);flex:none}'
			+ '.tmp_badge{display:inline-flex;align-items:center;gap:4px;font-size:11px;line-height:16px;color:var(--dsw-alias-label-caption);white-space:nowrap}';

		const tagId = '@local/dsh-teammate-model-picker/picker.module.css';
		function injectStylesheet() {
			if (typeof document === 'undefined') return () => { };
			if (document.querySelector(`style[data-plugin-css="${tagId}"]`) !== null) return () => { };
			const tag = document.createElement('style');
			tag.dataset.plugin = '@local/dsh-teammate-model-picker';
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
			return () => tag.remove();
		}

		function unwrap(response, what) {
			if (response.ok) return response.value;
			throw new Error(`${what}: ${response.error?.code ?? 'remote'}: ${response.error?.message ?? 'failed'}`);
		}

		function makePickerApi(ctx) {
			return {
				async loadCatalog() {
					return unwrap(await ctx.remote.session.modelCatalog(), 'model catalog');
				},
				async readNamespace() {
					const view = unwrap(await ctx.remote.settings.describe(), 'settings describe');
					const entry = (view.namespaces ?? []).find((candidate) => candidate.ns === ROW_ID) ?? null;
					if (entry === null) return null;
					const raw = entry.value?.overrides ?? entry.user?.overrides;
					return { revision: entry.revision, overrides: Array.isArray(raw) ? raw : [] };
				},
				overrideFor(state, childId) {
					const found = (state?.overrides ?? []).find((entry) => entry?.childSessionId === childId);
					if (found === undefined) return null;
					return {
						provider: found.provider,
						model: found.model,
						...(found.reasoningEffort ? { reasoningEffort: found.reasoningEffort } : {}),
					};
				},
				async writeOverride(childId, selection) {
					const state = await this.readNamespace();
					const list = (state?.overrides ?? []).filter((entry) => entry?.childSessionId !== childId);
					list.push({
						childSessionId: childId,
						provider: selection.provider,
						model: selection.model,
						...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
					});
					const after = unwrap(
						await ctx.remote.settings.mutate(ROW_ID, [{ op: 'set', path: ['overrides'], value: list }], state?.revision),
						'settings mutate',
					);
					const raw = after?.value?.overrides ?? after?.user?.overrides;
					return Array.isArray(raw) ? raw : list;
				},
			};
		}

		/* Inline stand-ins for the primitives' outline icons (no Client import). */
		function IconChevronDown(props) {
			return h('svg', { className: props.className, width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
				h('path', { d: 'M2.5 4.5 6 8l3.5-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}
		function IconChevronRight() {
			return h('svg', { className: 'tmp_cellChevron', width: 12, height: 12, viewBox: '0 0 12 12', 'aria-hidden': true },
				h('path', { d: 'M4.5 2.5 8 6l-3.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}
		function IconCheck() {
			return h('svg', { width: 14, height: 14, viewBox: '0 0 14 14', 'aria-hidden': true },
				h('path', { d: 'M2.5 7.5 5.5 10.5 11.5 3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }));
		}

		function rankByName(models, query) {
			const q = query.trim().toLowerCase();
			if (q.length === 0) return models;
			return models.filter((model) => `${model.name} ${model.id}`.toLowerCase().includes(q));
		}

		/**
		 * Trigger + two-pane menu, mirroring the official ModelSelect.
		 * Props: `sessionId`, `useSession`, `useProjection`, `t`, `picker`.
		 */
		function TeammateModelPicker(props) {
			const { sessionId, useSession, useProjection, t, picker } = props;
			const subagent = useSession((s) => s.subagent) ?? null;
			const projected = useProjection('modelSelection') ?? null;

			const [catalog, setCatalog] = useState(null);
			const [catalogError, setCatalogError] = useState(null);
			const [override, setOverride] = useState(null);
			const [status, setStatus] = useState('loading');
			const [writeError, setWriteError] = useState(null);
			const [open, setOpen] = useState(false);
			const [pane, setPane] = useState('root');
			const [query, setQuery] = useState('');
			const [menuPos, setMenuPos] = useState(null);
			const triggerRef = useRef(null);
			const menuRef = useRef(null);
			const searchRef = useRef(null);

			const childId = subagent?.address?.childSessionId ?? sessionId;
			const isTeammate = subagent !== null && subagent.address !== undefined;

			useEffect(() => {
				let alive = true;
				setStatus('loading');
				setCatalogError(null);
				picker.loadCatalog().then((value) => {
					if (!alive) return;
					setCatalog(value);
					setStatus('ready');
				}).catch((error) => {
					if (!alive) return;
					setCatalogError(error instanceof Error ? error.message : String(error));
					setStatus('error');
				});
				picker.readNamespace().then((state) => {
					if (!alive) return;
					setOverride(picker.overrideFor(state, childId));
				}).catch(() => { });
				return () => { alive = false; };
			}, [childId, picker]);

			const groups = useMemo(() => {
				const ordered = [...(catalog?.groups ?? [])];
				const rank = (id) => id === 'deepseek-account' ? 0 : id === 'deepseek-official' ? 1 : 2;
				return ordered.sort((a, b) => rank(a.id) - rank(b.id)).map((group) => ({
					...group,
					provider: { id: group.id, name: group.name },
				}));
			}, [catalog]);

			const choices = useMemo(() => groups.flatMap((group) => group.models.map((model) => ({
				group,
				model,
				selection: {
					provider: group.id,
					model: model.id,
					...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }),
				},
			}))), [groups]);

			const effective = override ?? projected?.next ?? projected?.lastUsed ?? catalog?.default ?? null;
			const currentChoice = effective === null
				? undefined
				: choices.find((c) => c.selection.provider === effective.provider && c.selection.model === effective.model);
			const modelLabel = currentChoice?.model.name
				?? (effective === null ? t('picker.default') : `${effective.provider}/${effective.model}`);
			const reasoning = currentChoice?.model.reasoning;
			const effortValue = effective?.reasoningEffort ?? reasoning?.defaultEffort;
			const effortLabel = reasoning === undefined
				? undefined
				: effortValue === undefined
					? t('picker.defaultEffort')
					: reasoning.efforts.find((level) => level.id === effortValue)?.name ?? effortValue;
			const triggerText = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`;
			const busy = status === 'writing';

			const showSearch = choices.length > 4;
			const filtered = useMemo(() => groups.map((group) => ({
				...group,
				models: rankByName(group.models, showSearch ? query.trim() : ''),
			})).filter((group) => group.models.length > 0), [groups, query, showSearch]);

			/**
			 * Official ModelSelect placement: anchor ABOVE the trigger
			 * (`rect.top - 8 - lh`), clamp to the viewport with a 12px margin,
			 * and re-measure whenever the menu's own size changes (pane switch,
			 * search filtering, catalog load) via ResizeObserver.
			 * useLayoutEffect makes the measure pass happen before paint, so the
			 * menu never flashes at the wrong origin.
			 */
			useLayoutEffect(() => {
				if (!open) { setMenuPos(null); return undefined; }
				const place = () => {
					const rect = triggerRef.current?.getBoundingClientRect();
					if (rect === undefined) return;
					const MARGIN = 12;
					const lw = menuRef.current?.offsetWidth ?? 0;
					const lh = menuRef.current?.offsetHeight ?? 0;
					let x = rect.right - lw;
					let y = rect.top - 8 - lh;
					if (lw > 0) x = Math.min(Math.max(x, MARGIN), window.innerWidth - lw - MARGIN);
					if (lh > 0) y = Math.min(Math.max(y, MARGIN), window.innerHeight - lh - MARGIN);
					setMenuPos({ left: x, top: y });
				};
				place();
				window.addEventListener('resize', place);
				window.addEventListener('scroll', place, true);
				const menu = menuRef.current;
				const observer = typeof ResizeObserver !== 'undefined' && menu !== null ? new ResizeObserver(place) : null;
				if (menu !== null) observer?.observe(menu);
				return () => {
					observer?.disconnect();
					window.removeEventListener('resize', place);
					window.removeEventListener('scroll', place, true);
				};
			}, [open, pane, query, catalog, status]);

			useEffect(() => {
				if (!open) return undefined;
				const onPointerDown = (event) => {
					const target = event.target;
					if (menuRef.current !== null && menuRef.current.contains(target)) return;
					if (triggerRef.current !== null && triggerRef.current.contains(target)) return;
					setOpen(false);
					setPane('root');
				};
				const onKeyDown = (event) => {
					if (event.key !== 'Escape') return;
					event.preventDefault();
					if (pane !== 'root') setPane('root');
					else { setOpen(false); setPane('root'); triggerRef.current?.focus(); }
				};
				document.addEventListener('pointerdown', onPointerDown, true);
				document.addEventListener('keydown', onKeyDown);
				return () => {
					document.removeEventListener('pointerdown', onPointerDown, true);
					document.removeEventListener('keydown', onKeyDown);
				};
			}, [open, pane]);

			useEffect(() => {
				if (open && pane === 'model' && showSearch) queueMicrotask(() => searchRef.current?.focus());
			}, [open, pane, showSearch]);

			const drill = (next) => { setQuery(''); setPane(next); };
			const close = (restoreFocus) => {
				setOpen(false);
				setPane('root');
				if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
			};

			const submit = useCallback(async (selection) => {
				setWriteError(null);
				setStatus('writing');
				try {
					const next = await picker.writeOverride(childId, selection);
					setOverride(picker.overrideFor({ overrides: next }, childId));
					setStatus('ready');
					close(true);
				} catch (error) {
					setStatus('ready');
					setWriteError(t('picker.error') + ': ' + (error instanceof Error ? error.message : String(error)));
				}
			}, [childId, picker, t]);

			if (!isTeammate) return null;

			const selected = (group, model) => effective !== null
				&& effective.provider === group.id && effective.model === model.id;

			const menu = h('div', {
				ref: menuRef,
				className: 'tmp_menu',
				role: pane === 'model' ? 'group' : 'menu',
				'aria-label': t('picker.label'),
				'aria-busy': status === 'loading' || busy,
				style: menuPos ?? MEASURE_STYLE,
			},
			writeError !== null ? h('div', { className: 'tmp_error' }, writeError) : null,
			pane === 'root' ? [
				h('button', {
					key: 'model-cell', type: 'button', role: 'menuitem', className: 'tmp_cell',
					onClick: () => drill('model'),
				},
				h('span', { className: 'tmp_cellLabel' }, t('picker.model')),
				h('span', { className: 'tmp_cellValue' }, modelLabel),
				h(IconChevronRight),
				),
				reasoning !== undefined ? h('button', {
					key: 'effort-cell', type: 'button', role: 'menuitem', className: 'tmp_cell',
					onClick: () => drill('effort'),
				},
				h('span', { className: 'tmp_cellLabel' }, t('picker.effort')),
				h('span', { className: 'tmp_cellValue' }, effortLabel ?? t('picker.defaultEffort')),
				h(IconChevronRight),
				) : null,
			] : null,
			pane === 'model' ? [
				showSearch ? h('div', { key: 'search', className: 'tmp_searchRow' },
					h('div', { className: query ? 'tmp_search tmp_searchWithQuery' : 'tmp_search' },
						h('input', {
							ref: searchRef, type: 'text', role: 'searchbox',
							'aria-label': t('picker.search'), placeholder: t('picker.search'),
							value: query, readOnly: busy,
							onChange: (event) => setQuery(event.target.value),
						}),
					),
					query !== '' ? h('button', {
						type: 'button', className: 'tmp_searchClear', 'aria-label': t('picker.back'),
						onClick: () => { setQuery(''); searchRef.current?.focus(); },
					}, '×') : null,
				) : null,
				h('button', { key: 'back', type: 'button', className: 'tmp_cell', onClick: () => setPane('root') },
					h('span', { className: 'tmp_cellLabel' }, '‹ ' + t('picker.back')),
				),
				status === 'loading' ? h('div', { key: 'loading', className: 'tmp_status' }, t('picker.loading')) : null,
				busy ? h('div', { key: 'writing', className: 'tmp_status' }, t('picker.applying')) : null,
				catalogError !== null ? h('div', { key: 'cerr', className: 'tmp_error' }, catalogError) : null,
				(catalog?.failures ?? []).map((failure) => h('div', { key: `f:${failure.id}`, className: 'tmp_warning' },
					h('span', null, `${failure.name}: ${failure.message}`),
				)),
				status === 'ready' && filtered.length === 0
					? h('div', { key: 'empty', className: 'tmp_empty', role: 'status' }, query.trim() ? t('picker.noResults') : t('picker.empty'))
					: h('div', { key: 'groups', className: 'tmp_groups', role: 'menu' },
						filtered.map((group) => h('div', { key: `g:${group.id}` },
							h('div', { className: 'tmp_groupLabel' }, group.provider.name),
							group.models.map((model) => h('button', {
								key: `m:${model.id}`,
								type: 'button', role: 'menuitemradio', 'aria-checked': selected(group, model),
								className: 'tmp_option', title: model.name, disabled: busy,
								onClick: () => { void submit({ provider: group.id, model: model.id, ...(model.reasoning?.defaultEffort === undefined ? {} : { reasoningEffort: model.reasoning.defaultEffort }) }); },
							},
							h('span', { className: 'tmp_optionCopy' },
								h('span', { className: 'tmp_modelName' }, model.name),
							),
							h('span', { className: 'tmp_check' }, selected(group, model) ? h(IconCheck) : null),
							)),
						)),
					),
			] : null,
			pane === 'effort' ? [
				h('button', { key: 'back', type: 'button', className: 'tmp_cell', onClick: () => setPane('root') },
					h('span', { className: 'tmp_cellLabel' }, '‹ ' + t('picker.back')),
				),
				...[
					...(reasoning?.defaultEffort === undefined ? [{ key: 'default', effort: undefined, label: t('picker.defaultEffort') }] : []),
					...(reasoning?.efforts ?? []).map((level) => ({ key: `e:${level.id}`, effort: level.id, label: level.name })),
				].map((level) => h('button', {
					key: level.key, type: 'button', role: 'menuitemradio',
					'aria-checked': (effective?.reasoningEffort ?? reasoning?.defaultEffort) === level.effort,
					className: 'tmp_option', disabled: busy,
					onClick: () => {
						if (effective === null) return;
						void submit({ provider: effective.provider, model: effective.model, ...(level.effort === undefined ? {} : { reasoningEffort: level.effort }) });
					},
				},
				h('span', { className: 'tmp_optionCopy' }, h('span', { className: 'tmp_modelName' }, level.label)),
				h('span', { className: 'tmp_check' }, (effective?.reasoningEffort ?? reasoning?.defaultEffort) === level.effort ? h(IconCheck) : null),
				)),
			] : null,
			);

			return h('span', { className: 'tmp_root' },
				h('button', {
					ref: triggerRef, type: 'button', className: 'tmp_trigger',
					title: t('picker.hint'), 'aria-label': `${t('picker.label')}: ${triggerText}`,
					'aria-haspopup': 'menu', 'aria-expanded': open, disabled: busy,
					onClick: () => open ? close(false) : setOpen(true),
				},
				h('span', { className: 'tmp_triggerLabel' }, modelLabel),
				effortLabel !== undefined ? h('span', { className: 'tmp_triggerEffort' }, effortLabel) : null,
				override !== null ? h('span', { className: 'tmp_badge' }, t('picker.override')) : null,
				h(IconChevronDown, { className: open ? 'tmp_chevron tmp_chevronOpen' : 'tmp_chevron' }),
				),
				open && createPortal !== null && typeof document !== 'undefined' ? createPortal(menu, document.body) : (open ? menu : null),
			);
		}

		const inject = ['slots', 'locale', 'remote', 'remote.session', 'remote.settings'];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'teammate-model-picker: dictionaries');
			ctx.effect(injectStylesheet, 'teammate-model-picker: stylesheet');
			const api = makePickerApi(ctx);
			ctx.slots.inject(SLOT, () => ctx.slots.register({
				name: SLOT,
				id: ENTRY_ID,
				order: 10,
				locale: NS,
				inject: () => ({ picker: api }),
			}, TeammateModelPicker));
		}

		exports.inject = inject;
		exports.apply = apply;
		return module.exports;
	},
});
