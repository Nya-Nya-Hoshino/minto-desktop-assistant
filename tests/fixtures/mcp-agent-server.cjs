'use strict';
const {Server}=require('@modelcontextprotocol/sdk/server/index.js');
const {StdioServerTransport}=require('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema,CallToolRequestSchema}=require('@modelcontextprotocol/sdk/types.js');
const server=new Server({name:'MintoTestServer',version:'1.0.0'},{capabilities:{tools:{}}});
server.setRequestHandler(ListToolsRequestSchema,async()=>({tools:[{name:'Exact.Name',description:'Echo exact identifiers',inputSchema:{type:'object',properties:{value:{type:'string'}},required:['value'],additionalProperties:false}}]}));
server.setRequestHandler(CallToolRequestSchema,async request=>request.params.arguments.value==='ERROR'?{isError:true,content:[{type:'text',text:'remote failure'}]}:{content:[{type:'text',text:request.params.arguments.value}]});
server.connect(new StdioServerTransport()).catch(error=>{process.stderr.write(error.message);process.exitCode=1;});
