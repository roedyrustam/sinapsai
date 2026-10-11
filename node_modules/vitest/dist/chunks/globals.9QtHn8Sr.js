import { g as globalApis } from './constants.-juJ8b_4.js';
import { i as index } from './index.C4tKZ0yW.js';
import './run.BTlFXlnv.js';
import './index.cx-_w29y.js';
import './tinyrainbow.Ht9iggcq.js';
import './display.CXBnkt9a.js';
import './pathe.M-eThtNZ.CknpM8Or.js';
import './source-map.DUxvo12T.js';
import '../task-utils.js';
import './utils.DYj33du9.js';
import './spy.DgMTfhrK.js';
import 'chai';
import './plugins.D2ut1V9b.js';
import './offset.Dy-5Fdfn.js';
import './rpc.BTmCtPly.js';
import 'vite/module-runner';
import './index.DmDMHCg8.js';
import 'tinybench';
import 'expect-type';

function registerApiGlobally() {
	globalApis.forEach((api) => {
		// @ts-expect-error I know what I am doing :P
		globalThis[api] = index[api];
	});
}

export { registerApiGlobally };
