import React from 'react';
// Página de administración con el UI Kit vigente (@forge/react 12, render: native).
// El admin del sitio pega su token bz_ una vez; va por invoke al resolver de administración
// (admin-entry.run), que vuelve a exigir el rol admin en el servidor antes de tocar KVS.
// El token se guarda con kvs.setSecret (por instalación) y NUNCA se devuelve al front.
// Pendiente de ejercitar en entorno Forge real (forge tunnel/deploy): la CLI empaqueta este
// recurso; localmente solo se verifica su sintaxis con esbuild (jsx), no su render.
import { useState } from 'react';
import ForgeReconciler, { Form, Textfield, Label, SectionMessage, Text, Button, useForm } from '@forge/react';
import { invoke } from '@forge/bridge';

const AdminPage = () => {
  const [resultado, setResultado] = useState(null);
  // OJO: el useForm de @forge/react NO expone reset(); sí handleSubmit/getValues/trigger.
  const { handleSubmit, register, getFieldId } = useForm();

  const alEnviar = async ({ token }) => {
    try {
      await invoke('guardarToken', { token });
      const prueba = await invoke('probarToken', {});
      setResultado(prueba.ok
        ? { tipo: 'confirmation', texto: 'Token saved and verified against the mailbox.' }
        : { tipo: 'error', texto: `Token saved but the test failed: ${prueba.detalle}` });
    } catch (e) {
      setResultado({ tipo: 'error', texto: e.message });
    }
  };

  return (
    <>
      {/* UI Kit vigente (render:native): Form YA NO acepta submitButtonText/actionButtons;
          el submit es un <Button type="submit"> DENTRO del Form. Verificado contra
          @atlaskit/forge-react-types (codegen) y la doc "Upgrade to UI Kit latest version":
          con submitButtonText el host lo ignora en silencio y no pinta botón alguno. */}
      <Form onSubmit={handleSubmit(alEnviar)}>
        <Label labelFor={getFieldId('token')}>Mailbox token (bz_…)</Label>
        <Textfield {...register('token', { required: true })} placeholder="bz_…" type="password" />
        <Button type="submit" appearance="primary">Save and test token</Button>
      </Form>
      {resultado && (
        <SectionMessage appearance={resultado.tipo}>
          <Text>{resultado.texto}</Text>
        </SectionMessage>
      )}
      <Text>Each site configures its own mailbox.</Text>
    </>
  );
};

export default AdminPage;

// Con render: native el recurso debe montarse a sí mismo (ForgeReconciler), un default export
// solo no pinta nada. Verificado en el deploy de desarrollo: sin esta llamada el iframe carga
// el bundle pero la página queda en blanco.
ForgeReconciler.render(<AdminPage />);
