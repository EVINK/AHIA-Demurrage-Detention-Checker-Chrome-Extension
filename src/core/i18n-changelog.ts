// 更新日志 page (v1.3.0) messages. Same format as i18n-strings.ts: [Chinese source, English, Spanish].
// Each new changelog entry adds its texts here.
export const CHANGELOG_STRINGS=[
['更新日志','Changelog','Novedades'],
['每个版本新增的功能和修改。点按钮可直接跳到功能所在的位置。','New features and changes in each version. Use the buttons to jump to where a feature lives.','Funciones nuevas y cambios de cada versión. Use los botones para ir a donde está cada función.'],
['当前版本','Current version','Versión actual'],
['Matson 柜查询','Matson container check','Consulta de contenedores Matson'],
['在实验性功能里查 Matson 柜子：按 Matson 官网的事件和船期，把最新状态写到提柜表 B 列，可提时打 ✔，船到港后把行移到按码头排。先预览，确认后再写表。','Check Matson containers under Experimental: from the events and vessel schedule on matson.com, the latest status goes to column B of the pickup sheet, ✔ is set when the container can be picked up, and rows move under 按码头排 once the vessel arrives. Preview first, then write to the sheet.','Consulte contenedores Matson en Experimental: con los eventos y el itinerario de matson.com, el estado más reciente va a la columna B de la hoja de retiro, se marca ✔ cuando se puede retirar y las filas pasan a 按码头排 cuando llega el buque. Primero la vista previa, luego la escritura en la hoja.'],
['前往实验性功能','Go to Experimental','Ir a Experimental'],
['OOCL Demurrage LFD 查询','OOCL Demurrage LFD lookup','Consulta del LFD de Demurrage de OOCL'],
['OOCL 的 Demurrage 不再发邮件询问，插件登录 OOCL 网站自己查 LFD，和 Draydog 比较取较早的日期写到提柜表 K 列，并在 Draydog 加 SSL LFD 备注。查柜时也会自动查 OOCL 柜子。先在配置页填写 OOCL 账号。','OOCL Demurrage no longer sends an inquiry email: the plugin signs in to the OOCL website and reads the LFD itself, writes the earlier of the OOCL and Draydog dates to column K of the pickup sheet, and adds an SSL LFD note in Draydog. Check containers looks up OOCL containers too. Enter the OOCL account on the Settings page first.','El Demurrage de OOCL ya no envía un correo de consulta: el complemento inicia sesión en el sitio de OOCL y lee el LFD, escribe la fecha más temprana entre OOCL y Draydog en la columna K de la hoja de retiro y añade una nota SSL LFD en Draydog. Revisar contenedores también consulta los de OOCL. Primero introduzca la cuenta de OOCL en la página Ajustes.'],
['配置 OOCL 账号','Set up OOCL account','Configurar cuenta de OOCL'],
['前往查询页','Go to Search','Ir a Buscar'],
['前往查柜','Go to Check containers','Ir a Revisar contenedores'],
['还没有 OOCL 的配置，请先在配置页添加 OOCL。','There is no OOCL setup yet. Add OOCL on the Settings page first.','Todavía no hay configuración de OOCL. Añada OOCL en la página Ajustes.'],
['OOCL 的配置在航司模式下，请先切换到航司模式。','OOCL is set up in carrier mode. Switch to carrier mode first.','OOCL se configura en el modo naviera. Cambie primero al modo naviera.'],
];
